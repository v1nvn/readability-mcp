// Metadata cascade (DESIGN §6.1). Each metadata field is resolved by priority:
//   JSON-LD → OpenGraph → Twitter → <meta>/<time> → Readability → <title>
// The first non-empty value wins. Sources are read from the pipeline-owned,
// normalized document (before the Readability clone), so the structured-metadata
// layers (JSON-LD/OG/Twitter) — which Readability discards — still surface.
// Readability's values then fill any gaps, and `<title>` is the final fallback.

import type { Metadata } from '../pipeline/context.js';
import type { ReadabilityParseResult } from '../pipeline/readability.js';

// Article-ish schema.org types whose fields we trust for article metadata.
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

// A line that is harmless but real (e.g. empty string vs absent). We treat
// whitespace-only strings as empty throughout the cascade.
function nonEmpty(value: string | undefined): string | undefined {
  return value?.trim() ? value : undefined;
}

// First non-empty value in priority order.
function first(...values: readonly (string | undefined)[]): string | undefined {
  for (const value of values) {
    const picked = nonEmpty(value);
    if (picked) {
      return picked;
    }
  }
  return undefined;
}

// --- <meta> helpers -------------------------------------------------------
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

// --- JSON-LD helpers ------------------------------------------------------
// Flatten every <script type="application/ld+json"> into candidate objects.
// A single script may hold an array or a `@graph` array; both unwrap. Invalid
// JSON is skipped silently — it is not article metadata and must never crash
// extraction.
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
  // A @graph holds the real subjects when the wrapper is a context binding.
  // `in` guards the access because the index signature types values as
  // JsonLdValue (no `undefined`), so a `!== undefined` check has no overlap.
  if ('@graph' in value) {
    collectObjects(value['@graph'], out);
  }
  out.push(value);
}

function typeMatches(type: JsonLdValue): boolean {
  const types = Array.isArray(type) ? type : [type];
  return types.some(t => typeof t === 'string' && ARTICLE_TYPES.has(t));
}

// Prefer an explicitly article-typed node; fall back to the first node so a
// page with only a bare WebPage/Thing still yields its headline/description.
function pickArticleNode(
  candidates: readonly JsonLdObject[],
): JsonLdObject | undefined {
  if (candidates.length === 0) {
    return undefined;
  }
  return candidates.find(node => typeMatches(node['@type'])) ?? candidates[0];
}

// Authors can be a string, a Person/ Organization object, an array of either,
// or a {@list: [...]} container. Reduce to a comma-joined byline string.
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
    // {@list: [...]} uses an array wrapper for ordering; unwrap it.
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

// Index a nested JSON-LD value only when it is itself an object; primitives and
// arrays have no string-keyed fields, so return undefined rather than casting.
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
  // Pipeline-owned, normalized document (pre-Readability clone).
  readonly document: Document;
  readonly readability?: null | ReadabilityParseResult;
  readonly readingTimeMin: number;
  readonly textContent: string;
  readonly url?: string;
  readonly wordCount: number;
}

export function resolveMetadata(input: Readonly<MetadataInput>): Metadata {
  const { document, readability } = input;

  // --- document-side tiers (JSON-LD → OG → Twitter → meta/time) ---
  const jsonLd = pickArticleNode(parseJsonLd(document));
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
    // First <time datetime> in the document is the canonical publish timestamp
    // for article templates that render it inline in the byline.
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

  return {
    title,
    byline,
    siteName,
    lang,
    publishedTime,
    excerpt,
    url: input.url,
    wordCount: input.wordCount,
    readingTimeMin: input.readingTimeMin,
  };
}
