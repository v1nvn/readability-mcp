import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractArticle } from '../../../src/tools/extract.js';
import { htmlToMarkdown } from '../../../src/tools/html_to_markdown.js';
import type { StructuredContent } from '../../../src/tools/output-schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, 'saved.html');
const pageUrl = 'https://docs.example.com/guides/code-langs';

function payloadText(result: ReturnType<typeof extractArticle>): string {
  const first = result.content[0];
  return first && 'text' in first ? first.text : '';
}

describe('code-langs: extract emits tagged fences', () => {
  it('produces fenced blocks for all four conventions', () => {
    const html = readFileSync(fixturePath, 'utf8');
    const result = extractArticle({
      html,
      url: pageUrl,
      format: 'markdown',
      gfm: true,
    });

    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as StructuredContent;
    expect(structured.diagnostics.readerable).toBe(true);
    expect(structured.diagnostics.fallbackUsed).toBe(false);

    const text = payloadText(result);
    // `\b` after the token stops ```js from matching the ```javascript fence.
    expect(text).toMatch(/```js\b/);
    expect(text).toMatch(/```shell\b/);
    expect(text).toMatch(/```javascript\b/);
    expect(text).toMatch(/```ts\b/);
  });
});

describe('code-langs: html_to_markdown is unchanged', () => {
  it('tags a GitHub block via gfm native extraction (canonicalizeCodeBlocks is extract-only)', () => {
    const result = htmlToMarkdown({
      html: '<div class="highlight highlight-source-js"><pre><code>const x = 1;</code></pre></div>',
      url: pageUrl,
      format: 'markdown',
      gfm: true,
    });
    const text = payloadText(result);

    // turndown-plugin-gfm reads the token straight off the wrapper class, so
    // html_to_markdown tags this block without any canonicalization step.
    // canonicalizeCodeBlocks is scoped to the extract path; this asserts it has
    // not leaked onto html_to_markdown and the output is unchanged.
    expect(text.trim()).toBe('```js\nconst x = 1;\n```');
  });
});
