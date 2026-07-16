// Readability wrapper (DESIGN §6.3). Two guarantees live here:
//   1. Readability MUTATES its document, so `parseArticle` always feeds it a
//      `cloneNode(true)` private copy — never the document the pipeline holds.
//   2. `isReaderable` is read-only and safe to run on the shared document.

import { isProbablyReaderable, Readability } from '@mozilla/readability';

export interface ReadabilityParseResult {
  readonly byline?: null | string;
  readonly content?: null | string;
  readonly dir?: null | string;
  readonly excerpt?: null | string;
  readonly lang?: null | string;
  readonly length?: null | number;
  readonly publishedTime?: null | string;
  readonly siteName?: null | string;
  readonly textContent?: null | string;
  readonly title?: null | string;
}

// Readability's constructor options (subset we expose + escape-hatch extras).
// Kept as a plain interface so policy/resolver can build it without importing
// Readability's private option shape.
export interface ReadabilityOptions {
  readonly charThreshold?: number;
  readonly keepClasses?: boolean;
  readonly maxElemsToParse?: number;
  readonly nbTopCandidates?: number;
  readonly [key: string]: unknown;
}

export function isReaderable(document: Document): boolean {
  return isProbablyReaderable(document);
}

export function parseArticle(
  document: Document,
  options?: Readonly<ReadabilityOptions>,
): null | ReadabilityParseResult {
  // Clone so Readability's in-place mutation never touches the pipeline's doc.
  // cloneNode is typed as Node; jsdom returns a full Document clone here.
  const clone = document.cloneNode(true) as Document;
  // The escape hatch lets callers pass keys the bundled .d.ts doesn't list
  // (e.g. linkDensityModifier), so cast through unknown to the ctor's option type.
  const reader = new Readability(clone, options);
  return reader.parse();
}
