import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { detectList } from '../src/policy/list-detector.js';
import { buildDocument } from '../src/pipeline/dom.js';
import { extractListFromHtml } from '../src/tools/extract_list.js';
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
    const result = extractListFromHtml({ html, baseUrl: 'https://example.com/' });
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
    const result = extractListFromHtml({ html, baseUrl: 'https://example.com/' });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as ExtractListStructuredContent;
    expect(structured.diagnostics.detected).toBe(false);
    expect(structured.items).toHaveLength(0);
    expect(structured.content).toMatch(/not a list/i);
  });
});

// Snippet contract: empty for title-only items, the clipped body otherwise.
// Inline HTML mirrors the search fixture's `<div class="g">` sibling-anchor
// shape (newlines between title and body produce the separator text node the
// detector's `slice(title.length + 1)` relies on) so the test exercises the
// same detection path real feeds use.
describe('extractItem: snippet resolution', () => {
  function listHtml(items: string): string {
    return `<html><body><main><div id="list">${items}</div></main></body></html>`;
  }

  it('emits an empty snippet for a title-only item (anchor text, no surrounding body)', () => {
    const html = listHtml(
      '<div class="g"><a href="https://example.com/a">Title only A</a></div>\n' +
        '<div class="g"><a href="https://example.com/b">Title only B</a></div>\n' +
        '<div class="g"><a href="https://example.com/c">Title only C</a></div>',
    );
    const { document } = buildDocument(html, 'https://example.com/');
    const result = detectList(document, 'https://example.com/');
    expect(result.detected).toBe(true);
    expect(result.items.length).toBe(3);
    for (const item of result.items) {
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.url.length).toBeGreaterThan(0);
      expect(item.snippet).toBe('');
    }
  });

  it('emits a non-empty snippet (the clipped body) when body text follows the title', () => {
    const html = listHtml(
      '<div class="g">\n' +
        '  <a href="https://example.com/a">Title with body</a>\n' +
        '  <p>Body text beyond the title that should become the snippet.</p>\n' +
        '</div>\n' +
        '<div class="g">\n' +
        '  <a href="https://example.com/b">Second title</a>\n' +
        '  <p>Second body that should be clipped into the snippet field.</p>\n' +
        '</div>\n' +
        '<div class="g">\n' +
        '  <a href="https://example.com/c">Third title</a>\n' +
        '  <p>Third body that should be clipped into the snippet field.</p>\n' +
        '</div>',
    );
    const { document } = buildDocument(html, 'https://example.com/');
    const result = detectList(document, 'https://example.com/');
    expect(result.detected).toBe(true);
    expect(result.items.length).toBe(3);
    for (const item of result.items) {
      expect(item.snippet.length).toBeGreaterThan(0);
      expect(item.snippet).not.toBe(item.title);
    }
    const byUrl = new Map(result.items.map(item => [item.url, item]));
    expect(byUrl.get('https://example.com/a')?.snippet).toBe(
      'Body text beyond the title that should become the snippet.',
    );
  });

  it('mixes title-only and title+body items in the same list', () => {
    const html = listHtml(
      '<div class="g"><a href="https://example.com/a">Title only</a></div>\n' +
        '<div class="g">\n' +
        '  <a href="https://example.com/b">With body</a>\n' +
        '  <p>Body text that should become the snippet.</p>\n' +
        '</div>\n' +
        '<div class="g"><a href="https://example.com/c">Also title only</a></div>\n' +
        '<div class="g">\n' +
        '  <a href="https://example.com/d">Another with body</a>\n' +
        '  <p>More body text for the snippet.</p>\n' +
        '</div>',
    );
    const { document } = buildDocument(html, 'https://example.com/');
    const result = detectList(document, 'https://example.com/');
    expect(result.detected).toBe(true);
    expect(result.items.length).toBe(4);
    const byUrl = new Map(result.items.map(item => [item.url, item]));
    expect(byUrl.get('https://example.com/a')?.snippet).toBe('');
    expect(byUrl.get('https://example.com/b')?.snippet).toBe(
      'Body text that should become the snippet.',
    );
    expect(byUrl.get('https://example.com/c')?.snippet).toBe('');
    expect(byUrl.get('https://example.com/d')?.snippet).toBe(
      'More body text for the snippet.',
    );
  });
});
