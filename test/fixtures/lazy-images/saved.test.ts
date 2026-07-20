import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { htmlToMarkdownFromHtml } from '../../../src/tools/html_to_markdown.js';
import type { StructuredContent } from '../../../src/tools/output-schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, 'saved.html');
const pageUrl = 'https://example.com/blog/lazy';

function payloadText(result: ReturnType<typeof htmlToMarkdownFromHtml>): string {
  const first = result.content[0];
  return first && 'text' in first ? first.text : '';
}

describe('lazy-image resolution end-to-end', () => {
  it('populates diagnostics.imagesResolved and renders the real URLs', () => {
    const html = readFileSync(fixturePath, 'utf8');
    const result = htmlToMarkdownFromHtml({
      html,
      baseUrl: pageUrl,
      format: 'markdown',
    });

    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as StructuredContent;
    expect(structured.diagnostics.imagesResolved).toBe(2);

    const text = payloadText(result);
    expect(text).toContain('https://example.com/static/hero.jpg');
    expect(text).toContain('https://example.com/static/chart-1600.png');
  });
});
