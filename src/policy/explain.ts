import { Readability } from '@mozilla/readability';

import type { GatingSignal } from './gating.js';
import type { PaginationSignal } from './pagination.js';

import { buildDocument } from '../pipeline/dom.js';
import {
  applySelectors,
  normalizeDocument,
  resolveLazyImages,
  type SelectorScope,
} from '../pipeline/normalize.js';
import { isReaderable } from '../pipeline/readability.js';
import { assembleDiagnostics } from './diagnostics.js';
import { detectGating } from './gating.js';
import { detectPagination } from './pagination.js';
import { resolveReadabilityOptions } from './resolver.js';

// Readability stamps `{ contentScore }` on candidate DOM nodes under a
// `readability` expando (Readability.js:894/1272/1288). The property is
// untyped upstream, so reach it through `unknown` rather than a guessed shape.
interface ReadabilityExpando {
  readonly contentScore?: number;
}

export interface ExplainCandidate {
  readonly className: string;
  readonly id: string;
  readonly score: number;
  readonly selector: string;
  readonly tag: string;
  readonly textLength: number;
}

export interface ExplainRemovedNodes {
  readonly boilerplate: number;
  readonly chrome: number;
  readonly total: number;
}

export interface ExplainSnapshot {
  readonly html: string;
  readonly truncated: boolean;
}

export interface ExplainReport {
  readonly candidates: readonly ExplainCandidate[];
  readonly chosenRoot: ExplainCandidate | null;
  readonly fallbackUsed: boolean;
  readonly gating: GatingSignal | undefined;
  readonly pagination: PaginationSignal | undefined;
  readonly parseSucceeded: boolean;
  readonly readerable: boolean;
  readonly removedNodes: ExplainRemovedNodes;
  readonly snapshot: ExplainSnapshot;
}

export interface BuildExplainOptions {
  readonly html: string;
  readonly selectors?: Readonly<SelectorScope>;
  readonly snapshotMaxChars?: number;
  readonly topN?: number;
  readonly url?: string;
}

const DEFAULT_SNAPSHOT_MAX = 4000;
const DEFAULT_TOP_N = 5;

function describeSelector(parts: {
  className: string;
  id: string;
  tag: string;
}): string {
  // A CSS-ish hint for the host, not a unique locator — Readability's expando is
  // a JS-only property invisible to CSS, and we deliberately avoid an nth-child
  // chain that would be brittle against the host's live DOM. Tag + id + first
  // two classes is enough for a human to pick the node out of a small candidate
  // list.
  const idPart = parts.id ? `#${parts.id}` : '';
  const cls = parts.className
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .join('.');
  const classPart = cls ? `.${cls}` : '';
  return `${parts.tag.toLowerCase()}${idPart}${classPart}`;
}

function readScored(el: Element): ExplainCandidate | null {
  const stamp = (el as unknown as { readability?: ReadabilityExpando })
    .readability;
  const score = stamp?.contentScore;
  if (typeof score !== 'number') {
    return null;
  }
  const className = typeof el.className === 'string' ? el.className : '';
  const candidate = {
    className,
    id: el.id,
    score,
    tag: el.tagName,
    textLength: el.textContent.trim().length,
  };
  return { ...candidate, selector: describeSelector(candidate) };
}

function truncateSnapshot(html: string, max: number): ExplainSnapshot {
  if (html.length <= max) {
    return { html, truncated: false };
  }
  return { html: html.slice(0, max), truncated: true };
}

export function buildExplainReport(
  options: Readonly<BuildExplainOptions>,
): ExplainReport {
  const {
    html,
    selectors,
    snapshotMaxChars = DEFAULT_SNAPSHOT_MAX,
    topN = DEFAULT_TOP_N,
    url,
  } = options;

  const { document, window } = buildDocument(html, url);

  // Mirror the extract pipeline's ordering: gating detection must precede
  // normalization (chrome stripping would remove the overlay), and pagination
  // detection runs before applySelectors (a caller's include could hide the
  // sentinel but not the "more content exists" signal).
  const gating = detectGating(document);
  const documentElementCount = document.querySelectorAll('*').length;
  const normalizeCounts = normalizeDocument(document);
  resolveLazyImages(document);
  const pagination = detectPagination(document, url);
  applySelectors(document, selectors);

  const snapshot = truncateSnapshot(document.body.innerHTML, snapshotMaxChars);

  const readerable = isReaderable(document);
  const readabilityOptions = resolveReadabilityOptions({});

  // Clone so the normalized doc (and the snapshot above) is preserved untouched
  // — Readability restructures its input during parse.
  const clone = document.cloneNode(true) as Document;
  // Grab node references before parse: Readability detaches scored candidates
  // from the live tree while restructuring, so a post-parse querySelectorAll
  // finds almost nothing. The object refs held here keep their `readability`
  // stamps after being detached — that retention is what surfaces the real
  // per-candidate scores without forking the library or parsing its debug log.
  const heldNodes = Array.from(clone.querySelectorAll('*'));

  const reader = new Readability(clone, readabilityOptions);
  const article = reader.parse();
  const parseSucceeded = !!article?.content;

  const scored: ExplainCandidate[] = [];
  for (const el of heldNodes) {
    const entry = readScored(el);
    if (entry) {
      scored.push(entry);
    }
  }
  scored.sort((a, b) => b.score - a.score);

  const candidates = scored.slice(0, Math.max(0, topN));
  const chosenRoot = scored[0] ?? null;

  const diagnostics = assembleDiagnostics({
    articleHtml: article?.content ?? '',
    boilerplateRemoved: normalizeCounts.boilerplateRemoved,
    chromeRemoved: normalizeCounts.chromeRemoved,
    documentElementCount,
    extractedNode: 'readability',
    fallbackUsed: false,
    gated: gating,
    pagination,
    readerable,
    window,
  });

  return {
    candidates,
    chosenRoot,
    fallbackUsed: diagnostics.fallbackUsed,
    gating: diagnostics.gated,
    pagination: diagnostics.pagination,
    parseSucceeded,
    readerable: diagnostics.readerable ?? false,
    removedNodes: {
      boilerplate: diagnostics.boilerplateRemoved ?? 0,
      chrome: diagnostics.chromeRemoved ?? 0,
      total: diagnostics.removedNodes ?? 0,
    },
    snapshot,
  };
}
