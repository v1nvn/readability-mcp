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
  // Readability mutates its input document; clone so the pipeline's doc is untouched.
  const clone = document.cloneNode(true) as Document;
  const reader = new Readability(clone, options);
  return reader.parse();
}
