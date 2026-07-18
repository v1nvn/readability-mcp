import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { detectList } from '../src/policy/list-detector.js';
import { buildDocument } from '../src/pipeline/dom.js';
import { extractList } from '../src/tools/extract_list.js';
import type { ExtractListStructuredContent } from '../src/tools/output-schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, 'fixtures');

// Recall against URL sets rather than token overlap because the right
// abstraction for "did we find this feed item?" is the item's identity (its
// URL), not word-level similarity. The detector legitimately emits more items
// than the ground truth on HN (it surfaces both athing title rows and subtext
// rows), so a token-recall score would be diluted by the subtext noise; URL-set
// recall ignores that noise and answers the acceptance question directly:
// "of the items we expected, how many did the detector surface?"
function urlSetRecall(
  detected: readonly { url: string }[],
  expected: readonly { url: string }[],
): number {
  if (expected.length === 0) {
    return 0;
  }
  const detectedSet = new Set(detected.map(item => item.url));
  const expectedSet = new Set(expected.map(item => item.url));
  let hits = 0;
  for (const url of expectedSet) {
    if (detectedSet.has(url)) {
      hits++;
    }
  }
  return hits / expectedSet.size;
}

function readFixtureHtml(name: string): string {
  return readFileSync(join(fixturesDir, name, 'saved.html'), 'utf8');
}

function readFixtureExpected(
  name: string,
): readonly { title: string; url: string }[] {
  return JSON.parse(
    readFileSync(join(fixturesDir, name, 'expected.json'), 'utf8'),
  ) as readonly { title: string; url: string }[];
}

function detectFixture(name: string, url = 'https://example.com/') {
  const html = readFixtureHtml(name);
  const { document } = buildDocument(html, url);
  return detectList(document, url);
}

describe('detectList: recall on feed fixtures (≥0.80 acceptance bar)', () => {
  for (const fixture of ['hn', 'search', 'blog-index'] as const) {
    it(`recall ≥ 0.80 on ${fixture}`, () => {
      const result = detectFixture(fixture);
      const expected = readFixtureExpected(fixture);
      expect(result.detected).toBe(true);
      expect(result.itemCount).toBeGreaterThanOrEqual(3);
      const recall = urlSetRecall(result.items, expected);
      expect(recall).toBeGreaterThanOrEqual(0.8);
    });
  }
});

describe('detectList: no false positives on article fixtures', () => {
  // The list-shaped fixtures are excluded explicitly; every other directory
  // under test/fixtures is treated as an article-like page that must NOT
  // trigger detection. This is the false-positive guard the acceptance bar
  // calls out.
  const listFixtures = new Set(['hn', 'search', 'blog-index']);
  const articleFixtures = readdirSync(fixturesDir).filter(name => {
    if (listFixtures.has(name)) {
      return false;
    }
    return statSync(join(fixturesDir, name)).isDirectory();
  });

  for (const fixture of articleFixtures) {
    it(`does not detect ${fixture} as a list`, () => {
      const result = detectFixture(fixture);
      expect(result.detected).toBe(false);
      expect(result.items).toHaveLength(0);
    });
  }
});

describe('extract_list tool', () => {
  it('returns the detected items and diagnostics via structuredContent', () => {
    const html = readFixtureHtml('search');
    const result = extractList({ html, url: 'https://example.com/' });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as ExtractListStructuredContent;
    expect(structured.schemaVersion).toBe(1);
    expect(structured.diagnostics.detected).toBe(true);
    expect(structured.diagnostics.itemTag).toBe('DIV');
    expect(structured.items.length).toBeGreaterThanOrEqual(3);
    expect(structured.content).toContain('https://example.com/result-1');
  });

  it('returns a not-a-list result for an article page', () => {
    const html = readFixtureHtml('documentation');
    const result = extractList({ html, url: 'https://example.com/' });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as ExtractListStructuredContent;
    expect(structured.diagnostics.detected).toBe(false);
    expect(structured.items).toHaveLength(0);
    expect(structured.content).toMatch(/not a list/i);
  });
});
