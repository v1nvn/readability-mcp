import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { detectList } from '../../../src/policy/list-detector.js';
import { buildDocument } from '../../../src/pipeline/dom.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, 'saved.html');
const expectedPath = join(here, 'expected.json');
const pageUrl = 'https://search.example.com/search?q=typescript+tutorial';

describe('search fixture: the #search container holds the result items', () => {
  it('detects the result items and ignores the chrome nav menus', () => {
    const html = readFileSync(fixturePath, 'utf8');
    const { document } = buildDocument(html, pageUrl);
    const result = detectList(document, pageUrl);
    expect(result.detected).toBe(true);
    expect(result.itemTag).toBe('DIV');
    expect(result.containerSelector).toContain('search');
    // Chrome nav inside <header>/<footer> is stripped before detection, so
    // the chrome nav links never appear in the items.
    const urls = result.items.map(item => item.url);
    expect(urls).not.toContain('https://search.example.com/');
    expect(urls).not.toContain('https://search.example.com/news');
  });

  it('recovers every expected result URL (recall = 1.0)', () => {
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
