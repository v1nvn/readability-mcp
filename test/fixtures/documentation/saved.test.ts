// Documentation fixture golden test (DESIGN §9 taxonomy). Asserts that fenced
// code blocks keep their language tag (```ts) through Readability + Turndown.
// Readability's default `keepClasses:false` strips the `language-ts` class, which
// would yield a bare ``` fence; the resolver's classesToPreserve keeps it.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractArticle } from '../../../src/tools/extract.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, 'saved.html');
const goldenPath = join(here, 'saved.golden.md');
const pageUrl = 'https://docs.example.com/typescript/arrays';

function payloadText(result: ReturnType<typeof extractArticle>): string {
  const first = result.content[0];
  return first && 'text' in first ? first.text : '';
}

describe('golden: documentation saved.html', () => {
  it('preserves the language tag on fenced code blocks', () => {
    const html = readFileSync(fixturePath, 'utf8');
    const result = extractArticle({ html, url: pageUrl, format: 'markdown' });

    expect(result.isError).toBeFalsy();
    const text = payloadText(result);

    // Both code blocks render as ```ts — not bare ``` fences.
    const tsFences = (text.match(/```ts/g) ?? []).length;
    expect(tsFences).toBeGreaterThanOrEqual(2);

    if (process.env.UPDATE_GOLDENS) {
      writeFileSync(goldenPath, text);
      return;
    }
    const golden = readFileSync(goldenPath, 'utf8');
    expect(text).toBe(golden);
  });
});
