// Fallback cascade contract test (DESIGN §5.1, §9). This fixture is a text-free
// splash/gallery page: every visible word lives in an image alt attribute, so
// Readability's scorer finds zero article text and `parse()` returns null. The
// selector cascade must then salvage non-empty Markdown (image markdown) from
// <main> and report fallbackUsed=true with extractedNode naming the cascade root.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractArticle } from '../../../src/tools/extract.js';
import type { StructuredContent } from '../../../src/tools/output-schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, 'saved.html');
const pageUrl = 'https://aurora.example.com/';

function payloadText(result: ReturnType<typeof extractArticle>): string {
  const first = result.content[0];
  return first && 'text' in first ? first.text : '';
}

describe('fallback cascade: text-free splash page', () => {
  it('falls back to a cascade selector and yields non-empty content', () => {
    const html = readFileSync(fixturePath, 'utf8');
    const result = extractArticle({ html, url: pageUrl, format: 'markdown' });

    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as StructuredContent;
    expect(structured.diagnostics.readerable).toBe(false);
    expect(structured.diagnostics.fallbackUsed).toBe(true);
    // The cascade root is a real selector — never a path label like
    // 'readability' (main scorer) or the bare 'article' tag name.
    expect(structured.diagnostics.extractedNode).not.toBe('article');
    expect(structured.diagnostics.extractedNode).not.toBe('readability');
    expect(typeof structured.diagnostics.extractedNode).toBe('string');
    expect(structured.diagnostics.extractedNode?.length).toBeGreaterThan(0);

    const text = payloadText(result);
    expect(text.length).toBeGreaterThan(0);
    // Image markdown survives (alt text was the only content).
    expect(text).toMatch(/!\[/);
    // Metadata still resolves from <title>/OG even with no Readability article.
    expect(structured.metadata.title).toBeTruthy();
  });
});
