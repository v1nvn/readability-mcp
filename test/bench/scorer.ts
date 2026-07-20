import type { TraceStage } from '../../src/pipeline/context.js';
import { buildDocument } from '../../src/pipeline/dom.js';
import { extractArticleFromHtml } from '../../src/tools/extract.js';
import type { StructuredContent } from '../../src/tools/output-schema.js';

export interface PrecisionRecall {
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
}

export interface FixtureScore extends PrecisionRecall {
  readonly extractedText: string;
  readonly extractedTokens: number;
  readonly labeledText: string;
  readonly labeledTokens: number;
  readonly trace: readonly TraceStage[];
}

const TOKEN_PATTERN = /[\p{L}\p{N}]+/gu;

export function tokenize(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const match of text.toLowerCase().matchAll(TOKEN_PATTERN)) {
    const token = match[0];
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

export function tokenTotal(map: Map<string, number>): number {
  let total = 0;
  for (const count of map.values()) total += count;
  return total;
}

export function overlap(
  a: Map<string, number>,
  b: Map<string, number>,
): number {
  let shared = 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  for (const [token, count] of small) {
    const other = large.get(token);
    if (other !== undefined) {
      shared += Math.min(count, other);
    }
  }
  return shared;
}

// NaN propagates when either side has no word tokens (e.g. the `fallback`
// image-only gallery); callers exclude NaN scores from macro-averages.
export function scorePrecisionRecall(
  extracted: string,
  labeled: string,
): PrecisionRecall {
  const ext = tokenize(extracted);
  const lbl = tokenize(labeled);
  if (ext.size === 0 || lbl.size === 0) {
    return { precision: NaN, recall: NaN, f1: NaN };
  }
  const shared = overlap(ext, lbl);
  const precision = shared / tokenTotal(ext);
  const recall = shared / tokenTotal(lbl);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { f1, precision, recall };
}

export function scoreFixture(
  html: string,
  url: string,
  selector: string,
): FixtureScore {
  const labeledElement = buildDocument(html, url).document.querySelector(selector);
  if (!labeledElement) {
    throw new Error(`main-content selector did not resolve: ${selector}`);
  }
  const labeledText = labeledElement.textContent ?? '';
  const result = extractArticleFromHtml({ debug: true, format: 'text', html, baseUrl: url });
  const first = result.content[0];
  const extractedText = first && 'text' in first ? first.text : '';
  const trace =
    (result.structuredContent as StructuredContent).diagnostics.trace ?? [];
  const extTokens = tokenize(extractedText);
  const lblTokens = tokenize(labeledText);
  const { f1, precision, recall } = scorePrecisionRecall(extractedText, labeledText);
  return {
    extractedText,
    extractedTokens: tokenTotal(extTokens),
    f1,
    labeledText,
    labeledTokens: tokenTotal(lblTokens),
    precision,
    recall,
    trace,
  };
}
