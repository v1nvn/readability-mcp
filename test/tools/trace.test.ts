import { extractArticle } from '../../src/tools/extract.js';
import { htmlToMarkdown } from '../../src/tools/html_to_markdown.js';
import type { StructuredContent } from '../../src/tools/output-schema.js';
import { outputSchema } from '../../src/tools/output-schema.js';

const ARTICLE_HTML =
  '<html><head><title>Post</title></head><body><article><h1>Title</h1>' +
  '<p>One two three four five six seven eight nine ten.</p></article></body></html>';

const FRAGMENT_HTML =
  '<h2>Heading</h2><p>some fragment text here long enough to count.</p>';

type Trace = StructuredContent['diagnostics']['trace'];

function diagnosticsOf(
  result: ReturnType<typeof extractArticle> | ReturnType<typeof htmlToMarkdown>,
): StructuredContent['diagnostics'] {
  const parsed = outputSchema.parse(result.structuredContent);
  return parsed.diagnostics;
}

describe('extract: diagnostics.trace', () => {
  it('emits per-stage timings when debug:true', () => {
    const result = extractArticle({
      debug: true,
      html: ARTICLE_HTML,
      url: 'https://x.example/',
    });
    expect(result.isError).toBeFalsy();
    const { trace } = diagnosticsOf(result);
    expect(Array.isArray(trace)).toBe(true);
    expect((trace ?? []).length).toBeGreaterThan(0);

    const stages = new Set((trace ?? []).map(t => t.stage));
    // Main-path stages; fallback path substitutes one combined `fallback` stage
    // for sanitize + turndown — covered by the assertions on ms values below.
    expect(stages.has('normalize')).toBe(true);
    expect(stages.has('readability')).toBe(true);
    expect(stages.has('metadata')).toBe(true);
    expect(stages.has('sanitize') || stages.has('fallback')).toBe(true);

    for (const entry of trace ?? []) {
      expect(typeof entry.stage).toBe('string');
      expect(typeof entry.ms).toBe('number');
      expect(Number.isFinite(entry.ms)).toBe(true);
      expect(entry.ms).toBeGreaterThanOrEqual(0);
    }
  });

  it('leaves trace absent when debug is omitted', () => {
    const result = extractArticle({
      html: ARTICLE_HTML,
      url: 'https://x.example/',
    });
    const { trace } = diagnosticsOf(result);
    expect(trace).toBeUndefined();
  });

  it('leaves trace absent when debug:false', () => {
    const result = extractArticle({
      debug: false,
      html: ARTICLE_HTML,
      url: 'https://x.example/',
    });
    const { trace } = diagnosticsOf(result);
    expect(trace).toBeUndefined();
  });
});

describe('html_to_markdown: diagnostics.trace', () => {
  it('emits per-stage timings when debug:true', () => {
    const result = htmlToMarkdown({
      debug: true,
      html: FRAGMENT_HTML,
      url: 'https://x.example/',
    });
    expect(result.isError).toBeFalsy();
    const { trace } = diagnosticsOf(result);
    expect(Array.isArray(trace)).toBe(true);
    expect((trace ?? []).length).toBeGreaterThan(0);

    const stages = new Set((trace ?? []).map(t => t.stage));
    expect(stages.has('normalize')).toBe(true);
    expect(stages.has('turndown')).toBe(true);
    expect(stages.has('metadata')).toBe(true);

    for (const entry of trace ?? []) {
      expect(typeof entry.stage).toBe('string');
      expect(typeof entry.ms).toBe('number');
      expect(Number.isFinite(entry.ms)).toBe(true);
      expect(entry.ms).toBeGreaterThanOrEqual(0);
    }
  });

  it('leaves trace absent when debug is omitted', () => {
    const result = htmlToMarkdown({
      html: FRAGMENT_HTML,
      url: 'https://x.example/',
    });
    const { trace } = diagnosticsOf(result);
    expect(trace).toBeUndefined();
  });
});

// Compile-time guard: trace is_optional in the diagnostics shape.
const _traceCheck: Trace = undefined;
void _traceCheck;
