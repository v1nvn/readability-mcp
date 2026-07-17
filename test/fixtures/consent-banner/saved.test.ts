import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractArticle } from '../../../src/tools/extract.js';
import type { StructuredContent } from '../../../src/tools/output-schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, 'saved.html');
const pageUrl = 'https://news.example.com/world/consent-overlays';

function payloadText(result: ReturnType<typeof extractArticle>): string {
  const first = result.content[0];
  return first && 'text' in first ? first.text : '';
}

describe('consent-banner stripping end-to-end', () => {
  it('removes the OneTrust banner and preserves article prose', () => {
    const html = readFileSync(fixturePath, 'utf8');
    const result = extractArticle({ html, url: pageUrl, format: 'markdown' });

    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as StructuredContent;
    expect(structured.diagnostics.chromeRemoved).toBeGreaterThanOrEqual(1);

    const text = payloadText(result);
    expect(text).not.toMatch(/Accept all/i);
    expect(text).not.toMatch(/We use cookies/i);
    expect(text).not.toMatch(/Reject all/i);

    expect(text).toMatch(/How Consent Overlays Break Extraction/);
    expect(text).toMatch(
      /Removing them before scoring is one of the highest-leverage/,
    );
    expect(text).toMatch(/Why density math suffers/);
  });
});
