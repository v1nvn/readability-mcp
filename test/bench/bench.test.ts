import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buildDocument } from '../../src/pipeline/dom.js';
import { MAIN_CONTENT_NOTES, MAIN_CONTENT_SELECTORS } from './labels.js';
import { unifiedDiff } from './diff.js';
import { BENCH_FIXTURES, resolveFixturePath } from './fixtures.js';
import { computeMetrics, sampleExtraction, type FixtureMetrics } from './metrics.js';
import {
  scoreFixture,
  scorePrecisionRecall,
  tokenize,
  type PrecisionRecall,
} from './scorer.js';

const here = dirname(fileURLToPath(import.meta.url));
const baselineDir = join(here, 'baseline');

describe('bench: computeMetrics', () => {
  it('returns typed metric fields on synthetic HTML', () => {
    const html =
      '<html><body><article><h1>Title</h1><p>Hello world this is enough text</p>' +
      '<a href="/x">link</a></article></body></html>';
    const metrics = computeMetrics(html, 'https://example.com/x');

    expect(typeof metrics.inputNodes).toBe('number');
    expect(typeof metrics.markdownChars).toBe('number');
    expect(typeof metrics.tokenEstimate).toBe('number');
    expect(typeof metrics.removedNodes).toBe('number');
    expect(typeof metrics.images).toBe('number');
    expect(typeof metrics.tables).toBe('number');
    expect(typeof metrics.links).toBe('number');
    expect(typeof metrics.compressionRatio).toBe('number');
    expect(typeof metrics.fallbackUsed).toBe('boolean');
    expect(typeof metrics.readerable).toBe('boolean');

    expect(metrics.tokenEstimate).toBe(Math.round(metrics.markdownChars / 4));
    expect(metrics.compressionRatio).toBe(
      Math.round((metrics.markdownChars / metrics.inputNodes) * 100) / 100,
    );
  });
});

describe('bench: unifiedDiff', () => {
  it('emits a hunk header with -removed and +added lines', () => {
    const diff = unifiedDiff('a\nb', 'a\nc');
    expect(diff).toContain('@@');
    expect(diff).toContain('-b');
    expect(diff).toContain('+c');
  });

  it('returns an empty string when inputs are identical', () => {
    expect(unifiedDiff('x\ny', 'x\ny')).toBe('');
  });
});

describe('bench: scorePrecisionRecall', () => {
  it('returns P=R=F1=1 for identical strings', () => {
    const s = 'the quick brown fox jumps over the lazy dog';
    const r = scorePrecisionRecall(s, s);
    expect(r.precision).toBe(1);
    expect(r.recall).toBe(1);
    expect(r.f1).toBe(1);
  });

  it('returns P=R=F1=0 for disjoint strings', () => {
    const r = scorePrecisionRecall('alpha beta gamma', 'xray yankee zulu');
    expect(r.precision).toBe(0);
    expect(r.recall).toBe(0);
    expect(r.f1).toBe(0);
  });

  it('returns precision=1, recall<1 when extracted is a proper subset of labeled', () => {
    const extracted = 'alpha beta gamma';
    const labeled = 'alpha beta gamma delta epsilon zeta';
    const r = scorePrecisionRecall(extracted, labeled);
    expect(r.precision).toBe(1);
    expect(r.recall).toBeLessThan(1);
    expect(r.recall).toBeCloseTo(0.5, 5);
    expect(r.f1).toBeLessThan(1);
    expect(r.f1).toBeGreaterThan(0);
  });

  it('returns recall=1, precision<1 when labeled is a proper subset of extracted', () => {
    const extracted = 'alpha beta gamma delta epsilon zeta';
    const labeled = 'alpha beta gamma';
    const r = scorePrecisionRecall(extracted, labeled);
    expect(r.recall).toBe(1);
    expect(r.precision).toBeLessThan(1);
    expect(r.precision).toBeCloseTo(0.5, 5);
    expect(r.f1).toBeLessThan(1);
    expect(r.f1).toBeGreaterThan(0);
  });

  it('counts shared tokens by their multiset minimum', () => {
    // "the" appears twice in extracted, three times in labeled → overlap contributes 2.
    const extracted = 'the the';
    const labeled = 'the the the';
    const r = scorePrecisionRecall(extracted, labeled);
    expect(r.precision).toBe(1);
    expect(r.recall).toBeCloseTo(2 / 3, 5);
  });

  it('returns NaN for empty extracted', () => {
    const r = scorePrecisionRecall('', 'some labeled text');
    expect(Number.isNaN(r.precision)).toBe(true);
    expect(Number.isNaN(r.recall)).toBe(true);
    expect(Number.isNaN(r.f1)).toBe(true);
  });

  it('returns NaN for empty labeled', () => {
    const r = scorePrecisionRecall('some extracted text', '');
    expect(Number.isNaN(r.precision)).toBe(true);
  });

  it('tokenizes on Unicode word boundaries (no stemming, no stop-word removal)', () => {
    const counts = tokenize('The THE thé café—café, NODE.js');
    expect(counts.get('the')).toBe(2);
    expect(counts.get('thé')).toBe(1);
    expect(counts.get('café')).toBe(2);
    expect(counts.get('node')).toBe(1);
    expect(counts.get('js')).toBe(1);
  });
});

describe('bench: main-content labels resolve', () => {
  for (const fixture of BENCH_FIXTURES) {
    it(`${fixture.id}: selector resolves to a non-null element in saved.html`, () => {
      const selector = MAIN_CONTENT_SELECTORS[fixture.id];
      expect(selector, `no selector labeled for ${fixture.id}`).toBeDefined();
      const html = readFileSync(resolveFixturePath(fixture), 'utf8');
      const el = buildDocument(html, fixture.url).document.querySelector(selector);
      expect(el, `${fixture.id}: selector "${selector}" did not resolve`).not.toBeNull();
    });

    it(`${fixture.id}: has a self-contained MAIN_CONTENT_NOTES entry`, () => {
      const note = MAIN_CONTENT_NOTES[fixture.id];
      expect(typeof note).toBe('string');
      expect(note.length).toBeGreaterThan(0);
    });
  }
});

describe('bench: regression guard', () => {
  const baseline = JSON.parse(
    readFileSync(join(baselineDir, 'metrics.json'), 'utf8'),
  ) as Record<string, FixtureMetrics>;

  for (const fixture of BENCH_FIXTURES) {
    it(`${fixture.id}: current metrics match committed baseline`, () => {
      const html = readFileSync(resolveFixturePath(fixture), 'utf8');
      const metrics = computeMetrics(html, fixture.url);
      expect(metrics).toEqual(baseline[fixture.id]);
    });

    it(`${fixture.id}: extracted markdown matches committed baseline`, () => {
      const html = readFileSync(resolveFixturePath(fixture), 'utf8');
      const { markdown } = sampleExtraction(html, fixture.url);
      const baselineMd = readFileSync(
        join(baselineDir, `${fixture.id}.md`),
        'utf8',
      );
      expect(markdown).toBe(baselineMd);
    });
  }
});

describe('bench: scores regression guard', () => {
  const baseline = JSON.parse(
    readFileSync(join(baselineDir, 'scores.json'), 'utf8'),
  ) as Record<string, PrecisionRecall>;

  const scored: PrecisionRecall[] = [];
  for (const fixture of BENCH_FIXTURES) {
    const selector = MAIN_CONTENT_SELECTORS[fixture.id];
    if (!selector) continue;
    const html = readFileSync(resolveFixturePath(fixture), 'utf8');
    const { f1, precision, recall } = scoreFixture(html, fixture.url, selector);
    const current: PrecisionRecall = { f1, precision, recall };
    const committed = baseline[fixture.id];

    it(`${fixture.id}: scores match committed baseline (or are both not-a-number)`, () => {
      expect(committed, `no scores.json entry for ${fixture.id}`).toBeDefined();
      // JSON.stringify(NaN) serializes to null; treat null/NaN as equivalent on
      // both sides so the image-only `fallback` fixture round-trips cleanly.
      if (Number.isNaN(precision) || committed.precision === null) {
        expect(Number.isNaN(precision)).toBe(true);
        expect(committed.precision).toBeNull();
        expect(committed.recall).toBeNull();
        expect(committed.f1).toBeNull();
        return;
      }
      expect(current).toEqual(committed);
    });

    if (!Number.isNaN(precision)) {
      scored.push(current);
    }
  }

  it('aggregate macro-average matches committed baseline', () => {
    const n = scored.length;
    expect(n).toBeGreaterThan(0);
    const macro: PrecisionRecall = {
      f1: scored.reduce((s, r) => s + r.f1, 0) / n,
      precision: scored.reduce((s, r) => s + r.precision, 0) / n,
      recall: scored.reduce((s, r) => s + r.recall, 0) / n,
    };
    // Round to 3dp to absorb float jitter across runs.
    const round3 = (x: number): number => Math.round(x * 1000) / 1000;
    expect(round3(macro.precision)).toBe(round3(baseline.aggregate.precision));
    expect(round3(macro.recall)).toBe(round3(baseline.aggregate.recall));
    expect(round3(macro.f1)).toBe(round3(baseline.aggregate.f1));
  });
});
