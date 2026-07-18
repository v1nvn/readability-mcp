import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { detectList } from '../../../src/policy/list-detector.js';
import { buildDocument } from '../../../src/pipeline/dom.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, 'saved.html');
const expectedPath = join(here, 'expected.json');
const pageUrl = 'https://news.ycombinator.com/';

describe('hn fixture: athing title rows surface as the list items', () => {
  it('detects ≥3 TR items under the stories table', () => {
    const html = readFileSync(fixturePath, 'utf8');
    const { document } = buildDocument(html, pageUrl);
    const result = detectList(document, pageUrl);
    expect(result.detected).toBe(true);
    expect(result.itemTag).toBe('TR');
    expect(result.itemCount).toBeGreaterThanOrEqual(3);
    // athing rows win the shape-key split against the classless subtext rows,
    // so every emitted item points at a story URL, not a user/comment URL.
    for (const item of result.items) {
      expect(item.url).toMatch(/^https:\/\/example\.com\/story-\d+$/);
    }
  });

  it('recovers every expected story URL (recall = 1.0)', () => {
    const html = readFileSync(fixturePath, 'utf8');
    const expected = JSON.parse(readFileSync(expectedPath, 'utf8')) as {
      title: string;
      url: string;
    }[];
    const { document } = buildDocument(html, pageUrl);
    const result = detectList(document, pageUrl);
    const detected = new Set(result.items.map(item => item.url));
    for (const item of expected) {
      expect(detected.has(item.url)).toBe(true);
    }
  });
});
