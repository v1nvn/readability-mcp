// Block-boundary truncation contract tests (DESIGN §5.1/§9). The invariant:
// when `maxChars` forces a cut, the cut lands at a block boundary and NEVER
// inside a fenced code block — the output contains an even number of ```
// delimiters (the fence is intact-or-absent, never half-open).

import { truncateMarkdown } from '../../src/policy/truncate.js';

import { extractArticle } from '../../src/tools/extract.js';

function fenceCount(text: string): number {
  return (text.match(/^ {0,3}`{3,}/gm) ?? []).length;
}

describe('policy.truncate', () => {
  it('is a no-op when the payload fits', () => {
    const md = '# Title\n\nShort body.';
    const res = truncateMarkdown(md, 1000);
    expect(res.truncated).toBe(false);
    expect(res.text).toBe(md);
  });

  it('cuts at a block boundary and appends the marker', () => {
    const md = '# Title\n\nFirst paragraph.\n\nSecond paragraph.';
    const res = truncateMarkdown(md, '# Title\n\nFirst paragraph.'.length + 5);
    expect(res.truncated).toBe(true);
    expect(res.text).toMatch(/…\[truncated\]$/);
    // The boundary landed between paragraphs, not mid-word.
    expect(res.text).toContain('First paragraph.');
    expect(res.text).not.toContain('Second paragraph.');
  });

  it('never leaves a fenced code block half-open (cut would land inside)', () => {
    const codeBlock = [
      '```ts',
      'const one = 1;',
      'const two = 2;',
      'const three = 3;',
      'const four = 4;',
      '```',
    ].join('\n');
    const md = `# Title\n\nIntro paragraph.\n\n${codeBlock}\n\nTrailing paragraph.`;
    // Budget sized so a naive char-cut would land inside the code block:
    // it comfortably fits the intro but cannot fit the full code block.
    const cutAfter = '# Title\n\nIntro paragraph.';

    const res = truncateMarkdown(md, cutAfter.length + codeBlock.length - 10);

    expect(res.truncated).toBe(true);
    expect(res.text).toMatch(/…\[truncated\]$/);
    // Fence count must be even (0 here — the whole code block is excluded).
    expect(fenceCount(res.text) % 2).toBe(0);
    // And no code interior leaked past the boundary.
    expect(res.text).not.toContain('const two');
  });

  it('keeps an intact fence when the code block fits but a later block does not', () => {
    const codeBlock = '```ts\nconst x = 1;\n```';
    const md = `# Title\n\n${codeBlock}\n\nLong trailing paragraph that will not fit.`;
    const res = truncateMarkdown(md, `# Title\n\n${codeBlock}`.length + 4);

    expect(res.truncated).toBe(true);
    // The code block survived intact → exactly two fence delimiters.
    expect(fenceCount(res.text)).toBe(2);
    expect(res.text).toContain('const x = 1;');
    expect(res.text).not.toContain('trailing');
  });

  it('excludes a sole oversized code block rather than splitting it', () => {
    const md = '```ts\nconst a = 1;\nconst b = 2;\nconst c = 3;\n```';
    const res = truncateMarkdown(md, 10);
    expect(res.truncated).toBe(true);
    expect(fenceCount(res.text) % 2).toBe(0);
    expect(res.text).not.toContain('const b');
  });
});

// Integration through the real tool: diagnostics.truncated must reflect the cut,
// and the contract (even fence count, no dangling ```) holds on the payload.
describe('extract truncation contract', () => {
  it('sets diagnostics.truncated and never leaves a half-open fence', () => {
    const html =
      '<html><head><title>Code Post</title></head><body><article>' +
      '<h1>Code Post</h1><p>Intro paragraph here is long enough.</p>' +
      '<pre><code class="language-ts">const one = 1;\nconst two = 2;\nconst three = 3;\nconst four = 4;</code></pre>' +
      '<p>A trailing paragraph that will not survive the budget.</p>' +
      '</article></body></html>';
    const result = extractArticle({
      html,
      url: 'https://example.com/code',
      format: 'markdown',
      maxChars: 80,
    });
    const first = result.content[0];
    const text = first && 'text' in first ? first.text : '';
    const diagnostics = (result.structuredContent as { diagnostics: { truncated: boolean } })
      .diagnostics;
    expect(diagnostics.truncated).toBe(true);
    expect(text).toMatch(/…\[truncated\]$/);
    expect(fenceCount(text) % 2).toBe(0);
  });
});
