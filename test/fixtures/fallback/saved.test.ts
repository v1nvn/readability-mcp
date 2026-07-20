import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractArticleFromHtml } from '../../../src/tools/extract.js';
import type { StructuredContent } from '../../../src/tools/output-schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, 'saved.html');
const pageUrl = 'https://aurora.example.com/';

function payloadText(result: ReturnType<typeof extractArticleFromHtml>): string {
  const first = result.content[0];
  return first && 'text' in first ? first.text : '';
}

describe('fallback cascade: text-free splash page', () => {
  it('falls back to a cascade selector and yields non-empty content', () => {
    const html = readFileSync(fixturePath, 'utf8');
    const result = extractArticleFromHtml({ html, baseUrl: pageUrl, format: 'markdown' });

    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as StructuredContent;
    expect(structured.diagnostics.readerable).toBe(false);
    expect(structured.diagnostics.fallbackUsed).toBe(true);
    expect(structured.diagnostics.extractedNode).not.toBe('article');
    expect(structured.diagnostics.extractedNode).not.toBe('readability');
    expect(typeof structured.diagnostics.extractedNode).toBe('string');
    expect(structured.diagnostics.extractedNode?.length).toBeGreaterThan(0);

    const text = payloadText(result);
    expect(text.length).toBeGreaterThan(0);
    expect(text).toMatch(/!\[/);
    expect(structured.metadata.title).toBeTruthy();
  });
});
