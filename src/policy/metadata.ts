import type { Metadata, StructuredData } from '../pipeline/context.js';
import type { ReadabilityParseResult } from '../pipeline/readability.js';

import { estimateTokens, nonEmpty } from './text.js';

const ARTICLE_TYPES = new Set([
  'Article',
  'BlogPosting',
  'NewsArticle',
  'Report',
  'ScholarlyArticle',
  'SocialMediaPosting',
  'TechArticle',
  'WebPage',
]);

type JsonLdValue =
  boolean | JsonLdObject | JsonLdValue[] | null | number | string;
interface JsonLdObject {
  readonly [key: string]: JsonLdValue;
}

function first(...values: readonly (string | undefined)[]): string | undefined {
  for (const value of values) {
    const picked = nonEmpty(value);
    if (picked) {
      return picked;
    }
  }
  return undefined;
}

function metaProperty(
  document: Document,
  property: string,
): string | undefined {
  return nonEmpty(
    document
      .querySelector(`meta[property="${property}"]`)
      ?.getAttribute('content') ?? undefined,
  );
}

function metaName(document: Document, name: string): string | undefined {
  return nonEmpty(
    document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ??
      undefined,
  );
}

// Flatten ld+json scripts (a script may hold an array or a @graph array).
// Invalid JSON is skipped — never crash extraction over malformed metadata.
function parseJsonLd(document: Document): JsonLdObject[] {
  const nodes = document.querySelectorAll('script[type="application/ld+json"]');
  const out: JsonLdObject[] = [];
  nodes.forEach(node => {
    const raw = node.textContent;
    if (!raw.trim()) {
      return;
    }
    let parsed: JsonLdValue;
    try {
      parsed = JSON.parse(raw) as JsonLdValue;
    } catch {
      return;
    }
    collectObjects(parsed, out);
  });
  return out;
}

function collectObjects(value: JsonLdValue, out: JsonLdObject[]): void {
  if (!value || typeof value !== 'object') {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectObjects(item, out);
    }
    return;
  }
  // `in` guard: the index signature types values as JsonLdValue (no undefined),
  // so a `!== undefined` check has no overlap.
  if ('@graph' in value) {
    collectObjects(value['@graph'], out);
  }
  out.push(value);
}

function typeMatches(type: JsonLdValue): boolean {
  const types = Array.isArray(type) ? type : [type];
  return types.some(t => typeof t === 'string' && ARTICLE_TYPES.has(t));
}

function pickArticleNode(
  candidates: readonly JsonLdObject[],
): JsonLdObject | undefined {
  if (candidates.length === 0) {
    return undefined;
  }
  return candidates.find(node => typeMatches(node['@type'])) ?? candidates[0];
}

// Preference order for the primary structured object: richest schema.org
// main-entity first. Article types are the tail fallback — Readability already
// captured the article body, so they are low-value-but-recognizable. Generic
// graph scaffolding (WebSite/Organization/BreadcrumbList) is intentionally NOT
// listed: emitting it as `structured` would be noise, and we prefer undefined
// over a misleading trivial node.
const STRUCTURED_PRIORITY = [
  'Recipe',
  'Product',
  'Event',
  'HowTo',
  'Course',
  'Movie',
  'Book',
  'MusicRecording',
  'JobPosting',
  'FAQPage',
  ...ARTICLE_TYPES,
] as const;

function nodeTypeList(node: JsonLdObject): readonly string[] {
  const type = node['@type'];
  if (Array.isArray(type)) {
    return type.filter((t): t is string => typeof t === 'string');
  }
  return typeof type === 'string' ? [type] : [];
}

// Iterate priority types in order so a Recipe wins over an earlier Article
// node, and document order wins among candidates of the same type.
function pickStructuredObject(
  candidates: readonly JsonLdObject[],
): JsonLdObject | undefined {
  for (const priorityType of STRUCTURED_PRIORITY) {
    const hit = candidates.find(node =>
      nodeTypeList(node).includes(priorityType),
    );
    if (hit) {
      return hit;
    }
  }
  return undefined;
}

// Strip @context (always https://schema.org, pure noise) and normalize a
// multi-typed node to a "+"-joined string so the host sees a single type label.
// Data fields are kept verbatim — the host wants the real schema.org object.
function cleanStructured(obj: JsonLdObject): StructuredData {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === '@context') {
      continue;
    }
    if (key === '@type') {
      const types = Array.isArray(value)
        ? value.filter((t): t is string => typeof t === 'string')
        : typeof value === 'string'
          ? [value]
          : [];
      out[key] = types.join('+');
      continue;
    }
    out[key] = value;
  }
  return out;
}

// Author may be a string, a Person/Organization object, an array, or a
// {@list: [...]} container; reduce to a comma-joined byline.
function resolveJsonLdAuthor(author: JsonLdValue): string | undefined {
  const names: string[] = [];
  function visit(value: JsonLdValue): void {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) {
        names.push(trimmed);
      }
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    // {@list: [...]} is an ordering wrapper; unwrap it.
    const list = value['@list'];
    if (Array.isArray(list)) {
      list.forEach(visit);
      return;
    }
    const name = value.name;
    if (typeof name === 'string') {
      const trimmed = name.trim();
      if (trimmed) {
        names.push(trimmed);
      }
    }
  }
  visit(author);
  return names.length > 0 ? names.join(', ') : undefined;
}

function asString(value: JsonLdValue | undefined): string | undefined {
  return typeof value === 'string' ? nonEmpty(value) : undefined;
}

function field(
  obj: JsonLdValue | undefined,
  key: string,
): JsonLdValue | undefined {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return undefined;
  }
  return obj[key];
}

export interface MetadataInput {
  readonly document: Document;
  readonly readability?: null | ReadabilityParseResult;
  readonly readingTimeMin: number;
  readonly textContent: string;
  readonly url?: string;
  readonly wordCount: number;
}

export function resolveMetadata(input: Readonly<MetadataInput>): Metadata {
  const { document, readability } = input;

  const jsonLdObjects = parseJsonLd(document);
  const jsonLd = pickArticleNode(jsonLdObjects);
  const structuredRaw = pickStructuredObject(jsonLdObjects);
  const htmlLang = nonEmpty(
    document.documentElement.getAttribute('lang') ?? undefined,
  );
  const titleFromTitleTag = nonEmpty(document.title);

  const title = first(
    asString(jsonLd?.headline),
    metaProperty(document, 'og:title'),
    metaName(document, 'twitter:title'),
    readability?.title ?? undefined,
    titleFromTitleTag,
  );

  const byline = first(
    jsonLd ? resolveJsonLdAuthor(jsonLd.author) : undefined,
    metaProperty(document, 'article:author'),
    metaName(document, 'author'),
    readability?.byline ?? undefined,
  );

  const siteName = first(
    asString(field(field(jsonLd, 'publisher'), 'name')),
    metaProperty(document, 'og:site_name'),
    readability?.siteName ?? undefined,
  );

  const lang = first(
    asString(jsonLd?.inLanguage),
    htmlLang,
    readability?.lang ?? undefined,
  );

  const publishedTime = first(
    asString(jsonLd?.datePublished),
    metaProperty(document, 'article:published_time'),
    // First <time datetime> is the canonical publish time when rendered inline.
    nonEmpty(
      document.querySelector('time[datetime]')?.getAttribute('datetime') ??
        undefined,
    ),
    readability?.publishedTime ?? undefined,
  );

  const excerpt = first(
    asString(jsonLd?.description),
    metaProperty(document, 'og:description'),
    metaName(document, 'twitter:description'),
    metaName(document, 'description'),
    readability?.excerpt ?? undefined,
  );

  // canonical/og:url are absolute by spec; returned raw so callers can tell
  // the declared canonical apart from the input url (origin context only).
  const canonical = first(
    nonEmpty(
      document.querySelector('link[rel="canonical"]')?.getAttribute('href') ??
        undefined,
    ),
    metaProperty(document, 'og:url'),
  );

  return {
    title,
    byline,
    siteName,
    lang,
    publishedTime,
    excerpt,
    canonical,
    url: input.url,
    wordCount: input.wordCount,
    readingTimeMin: input.readingTimeMin,
    ...estimateTokens(input.textContent),
    ...(structuredRaw ? { structured: cleanStructured(structuredRaw) } : {}),
  };
}
