import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { outlineDocumentFromHtml } from '../../../src/tools/outline.js';
import type { OutlineStructuredContent } from '../../../src/tools/output-schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, 'saved.html');
const goldenPath = join(here, 'saved.golden.json');
const pageUrl = 'https://docs.example.com/api';

function payloadText(
  result: ReturnType<typeof outlineDocumentFromHtml>,
): string {
  const first = result.content[0];
  return first && 'text' in first ? first.text : '';
}

describe('golden: outline saved.html', () => {
  it('yields the expected outline tree', () => {
    const html = readFileSync(fixturePath, 'utf8');
    const result = outlineDocumentFromHtml({ html, baseUrl: pageUrl });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as OutlineStructuredContent;

    if (process.env.UPDATE_GOLDENS) {
      writeFileSync(goldenPath, `${JSON.stringify(structured.outline, null, 2)}\n`);
      return;
    }

    const golden = JSON.parse(readFileSync(goldenPath, 'utf8'));
    expect(structured.outline).toEqual(golden);

    expect(payloadText(result)).toContain('API Reference');
  });
});
