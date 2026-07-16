import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractArticle } from '../../../src/tools/extract.js';
import type { StructuredContent } from '../../../src/tools/output-schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, 'saved.html');
const goldenPath = join(here, 'saved.golden.md');
const pageUrl = 'https://example.com/blog/post';

function payloadText(result: ReturnType<typeof extractArticle>): string {
  const first = result.content[0];
  return first && 'text' in first ? first.text : '';
}

describe('golden: react-spa saved.html', () => {
  it('extracts clean Markdown matching the reviewed golden', () => {
    const html = readFileSync(fixturePath, 'utf8');
    const result = extractArticle({ html, url: pageUrl, format: 'markdown', gfm: true });

    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as StructuredContent;
    expect(structured.diagnostics.readerable).toBe(true);
    expect(structured.diagnostics.fallbackUsed).toBe(false);
    expect(structured.diagnostics.extractedNode).toBe('readability');

    const text = payloadText(result);
    if (process.env.UPDATE_GOLDENS) {
      writeFileSync(goldenPath, text);
      return;
    }

    const golden = readFileSync(goldenPath, 'utf8');
    expect(text).toBe(golden);
  });
});
