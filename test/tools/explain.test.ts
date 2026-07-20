import {
  buildExplainReport,
  type BuildExplainOptions,
  type ExplainReport,
} from '../../src/policy/explain.js';
import { explainFromHtml, explainHandler } from '../../src/tools/explain.js';

// Modeled on a docs page: a <main><article> with multi-paragraph prose flanked
// by nav / aside / footer chrome. Readability should score the article far
// above the chrome containers; the runner-up (main) must still surface in the
// ranked candidate list so a mis-extraction is diagnosable.
const PROSE =
  'This is a long enough paragraph with commas, and content, and more content, ' +
  'to score well above the threshold that Readability uses for extraction. ';
const DOCS_HTML =
  '<!DOCTYPE html><html><head><title>Docs</title></head><body>' +
  '<nav><a href="/">Home</a><a href="/guide">Guide</a><a href="/api">API</a></nav>' +
  '<main><article>' +
  '<h1>Working with Extraction</h1>' +
  `<p>${PROSE.repeat(2)}</p>` +
  `<p>${PROSE.repeat(2)}</p>` +
  `<p>${PROSE.repeat(2)}</p>` +
  `<p>${PROSE.repeat(2)}</p>` +
  '</article></main>' +
  '<aside class="related-posts"><h3>Related</h3><a href="/other">Other</a></aside>' +
  '<footer><p>(c) 2026</p></footer>' +
  '</body></html>';

const ORIGIN = 'https://docs.example.com/guide/extraction';

function reportFor(
  html: string,
  overrides?: Partial<BuildExplainOptions>,
): ExplainReport {
  return buildExplainReport({ html, baseUrl: ORIGIN, ...overrides });
}

describe('explain report (buildExplainReport)', () => {
  it('identifies the article as the chosen root and ranks runners-up', () => {
    const report = reportFor(DOCS_HTML);
    expect(report.chosenRoot).not.toBeNull();
    expect(report.chosenRoot!.tag).toBe('ARTICLE');
    // The article must outrank every other container — that's the invariant
    // whose failure on a real page this tool exists to expose.
    expect(report.chosenRoot!.score).toBeGreaterThan(0);
    expect(report.candidates.length).toBeGreaterThan(0);
    // Scores strictly non-increasing.
    for (let i = 1; i < report.candidates.length; i++) {
      expect(report.candidates[i]!.score).toBeLessThanOrEqual(
        report.candidates[i - 1]!.score,
      );
    }
    // The runner-up container (<main>) survives in the ranking even though the
    // article won decisively — the diagnostic value is seeing the field.
    expect(report.candidates.some(c => c.tag === 'MAIN')).toBe(true);
    expect(report.candidates[0]!.tag).toBe('ARTICLE');
  });

  it('every candidate carries a selector, score, and textLength', () => {
    const report = reportFor(DOCS_HTML);
    for (const c of report.candidates) {
      expect(c.selector.length).toBeGreaterThan(0);
      // Each selector is anchored on the candidate's own lowercased tag.
      expect(c.selector.startsWith(c.tag.toLowerCase())).toBe(true);
      expect(typeof c.score).toBe('number');
      expect(c.textLength).toBeGreaterThanOrEqual(0);
    }
    // The article candidate specifically surfaces as a tag-only `article` selector.
    expect(report.candidates.some(c => c.selector === 'article')).toBe(true);
  });

  it('categorizes removed nodes (chrome/boilerplate stripped before Readability)', () => {
    const report = reportFor(DOCS_HTML);
    const r = report.removedNodes;
    expect(r.total).toBeGreaterThan(0);
    // The nav/aside/footer blocks are boilerplate-class and get stripped by
    // normalize; the count flows through the same diagnostics path as extract.
    expect(r.boilerplate + r.chrome).toBeGreaterThan(0);
  });

  it('captures a non-empty pre-Readability snapshot, truncated when large', () => {
    const report = reportFor(DOCS_HTML);
    expect(report.snapshot.html.length).toBeGreaterThan(0);
    expect(report.snapshot.truncated).toBe(false);
    expect(report.snapshot.html).toContain('<article>');

    const big = reportFor(DOCS_HTML, { snapshotMaxChars: 100 });
    expect(big.snapshot.truncated).toBe(true);
    expect(big.snapshot.html.length).toBe(100);
  });

  it('reports readerable + parseSucceeded true for genuine article content', () => {
    const report = reportFor(DOCS_HTML);
    expect(report.readerable).toBe(true);
    expect(report.parseSucceeded).toBe(true);
    expect(report.fallbackUsed).toBe(false);
  });

  it('honors selectors.include to scope the snapshot and scoring', () => {
    // Restrict to the article subtree: nav/aside/footer are gone from the
    // snapshot, so boilerplate stripping has nothing to remove.
    const report = reportFor(DOCS_HTML, { selectors: { include: 'article' } });
    expect(report.snapshot.html).not.toContain('<nav>');
    expect(report.snapshot.html).not.toContain('<aside');
    expect(report.candidates[0]!.tag).toBe('ARTICLE');
  });

  it('returns a null chosenRoot and empty candidates for empty input', () => {
    const report = reportFor('<html><body></body></html>');
    expect(report.chosenRoot).toBeNull();
    expect(report.candidates).toEqual([]);
    expect(report.parseSucceeded).toBe(false);
  });
});

describe('explain tool handler', () => {
  it('returns structured content validating against the output schema', () => {
    const result = explainFromHtml({ html: DOCS_HTML, baseUrl: ORIGIN });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.schemaVersion).toBe(1);
    expect(typeof sc.content).toBe('string');
    expect(sc.content).toContain('chosen root');
    // chosenRoot in structured content mirrors the report.
    const chosen = sc.chosenRoot as { tag: string; score: number };
    expect(chosen.tag).toBe('ARTICLE');
    expect(chosen.score).toBeGreaterThan(0);
    // content[0].text is the readable rendering and is never empty.
    const first = result.content[0]!;
    expect('text' in first && first.text.length).toBeGreaterThan(0);
  });

  it('returns { isError: true } for missing html and does not throw', () => {
    const result = explainHandler({});
    expect(result.isError).toBe(true);
    expect(result.content.length).toBeGreaterThan(0);
  });
});
