import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { unifiedDiff } from './diff.js';
import { BENCH_FIXTURES, resolveFixturePath } from './fixtures.js';
import { computeMetrics, sampleExtraction, type FixtureMetrics } from './metrics.js';

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
