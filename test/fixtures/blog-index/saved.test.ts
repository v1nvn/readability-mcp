import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { detectList } from '../../../src/policy/list-detector.js';
import { buildDocument } from '../../../src/pipeline/dom.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, 'saved.html');
const expectedPath = join(here, 'expected.json');
const pageUrl = 'https://blog.example.com/';

describe('blog-index fixture: the repeated <article class="post"> cluster wins', () => {
  it('detects ARTICLE items and ignores the header/footer nav', () => {
    const html = readFileSync(fixturePath, 'utf8');
    const { document } = buildDocument(html, pageUrl);
    const result = detectList(document, pageUrl);
    expect(result.detected).toBe(true);
    expect(result.itemTag).toBe('ARTICLE');
    expect(result.itemCount).toBeGreaterThanOrEqual(3);
    // The chrome nav links (Home/About/Archive/RSS/Privacy) live inside
    // <header>/<footer> and are stripped; they must not surface as items.
    const urls = result.items.map(item => item.url);
    expect(urls).not.toContain('https://blog.example.com/about');
    expect(urls).not.toContain('https://blog.example.com/privacy');
  });

  it('recovers every expected post URL (recall = 1.0)', () => {
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
