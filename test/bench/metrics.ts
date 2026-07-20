import { buildDocument } from '../../src/pipeline/dom.js';
import { extractArticleFromHtml } from '../../src/tools/extract.js';
import type { StructuredContent } from '../../src/tools/output-schema.js';

export interface FixtureMetrics {
  readonly compressionRatio: number;
  readonly fallbackUsed: boolean;
  readonly images: number;
  readonly inputNodes: number;
  readonly links: number;
  readonly markdownChars: number;
  readonly readerable: boolean;
  readonly removedNodes: number;
  readonly tables: number;
  readonly tokenEstimate: number;
}

export interface ExtractionSample {
  readonly markdown: string;
  readonly metrics: FixtureMetrics;
}

function payloadText(result: ReturnType<typeof extractArticleFromHtml>): string {
  const first = result.content[0];
  return first && 'text' in first ? first.text : '';
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// A GFM table is identified by its delimiter row (e.g. `| --- | :---: |`).
// Counting those rows is cheaper and less false-positive than counting every
// pipe-leading line, which also catches code that happens to start with `|`.
function countTables(markdown: string): number {
  return markdown.split('\n').filter(line => /^\|[\s:|-]+\|$/.test(line)).length;
}

export function sampleExtraction(html: string, url: string): ExtractionSample {
  const inputNodes = buildDocument(html, url).document.querySelectorAll('*').length;

  const result = extractArticleFromHtml({ format: 'markdown', html, baseUrl: url });
  const markdown = payloadText(result);
  const diagnostics = (result.structuredContent as StructuredContent).diagnostics;

  const images = (markdown.match(/!\[/g) ?? []).length;
  // `](` closes both [text](href) links and ![alt](src) images; subtracting the
  // image count keeps links from being inflated by image syntax.
  const links = Math.max(0, (markdown.match(/\]\(/g) ?? []).length - images);

  const metrics: FixtureMetrics = {
    inputNodes,
    markdownChars: markdown.length,
    tokenEstimate: Math.round(markdown.length / 4),
    removedNodes: diagnostics.removedNodes ?? 0,
    images,
    tables: countTables(markdown),
    links,
    compressionRatio: round2(markdown.length / Math.max(1, inputNodes)),
    fallbackUsed: diagnostics.fallbackUsed ?? false,
    readerable: diagnostics.readerable ?? false,
  };
  return { markdown, metrics };
}

export function computeMetrics(html: string, url: string): FixtureMetrics {
  return sampleExtraction(html, url).metrics;
}
