import { chunkMarkdown } from '../../src/policy/chunk.js';

describe('policy.chunk chunkMarkdown', () => {
  it('returns [] for empty input', () => {
    expect(chunkMarkdown('', { maxTokens: 100, overlap: 0, strategy: 'char' })).toEqual([]);
  });

  it('returns [] for whitespace-only input', () => {
    expect(
      chunkMarkdown('   \n\n  \n  ', {
        maxTokens: 100,
        overlap: 0,
        strategy: 'char',
      }),
    ).toEqual([]);
  });

  it('emits a single chunk when the input fits the budget', () => {
    const md = 'One paragraph.\n\nTwo paragraph.';
    const chunks = chunkMarkdown(md, {
      maxTokens: 1000,
      overlap: 0,
      strategy: 'char',
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].index).toBe(0);
    expect(chunks[0].text).toBe(md);
    expect(chunks[0].tokenCount).toBe(Math.round(md.length / 4));
    expect(chunks[0].headingContext).toBe('');
  });

  it('keeps every chunk within maxTokens even with oversized paragraphs and lines', () => {
    const huge = 'a'.repeat(2000);
    const longLine = 'b'.repeat(600);
    const md = [
      '# Title',
      '',
      'short intro',
      '',
      huge,
      '',
      `mid line ${longLine} trailing`,
      '',
      'tail paragraph',
    ].join('\n');
    const maxTokens = 50; // 200 chars budget
    const chunks = chunkMarkdown(md, {
      maxTokens,
      overlap: 0,
      strategy: 'char',
    });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(maxTokens);
      // Hard cap on the underlying text length too — tokenCount is chars/4,
      // so the text itself must fit in maxTokens * 4 chars.
      expect(chunk.text.length).toBeLessThanOrEqual(maxTokens * 4);
    }
    // Indices are sequential 0..n-1.
    expect(chunks.map(c => c.index)).toEqual(
      chunks.map((_, i) => i),
    );
  });

  it('covers the input when concatenating chunk texts (ignoring overlap)', () => {
    const md = [
      '# Heading',
      '',
      'first paragraph here',
      '',
      'second paragraph here',
      '',
      'third paragraph here',
      '',
      'fourth paragraph here',
    ].join('\n');
    const chunks = chunkMarkdown(md, {
      maxTokens: 6, // 24 chars — forces several chunks
      overlap: 0,
      strategy: 'char',
    });
    expect(chunks.length).toBeGreaterThan(1);
    // Every word from the input should survive in some chunk.
    const words = new Set(chunks.flatMap(c => c.text.split(/\s+/).filter(Boolean)));
    for (const expected of [
      'Heading',
      'first',
      'paragraph',
      'second',
      'third',
      'fourth',
    ]) {
      expect(words.has(expected)).toBe(true);
    }
  });

  it('carries the nearest preceding heading into following chunks and leaves pre-heading chunks empty', () => {
    const md = [
      'Intro before any heading.',
      '',
      '## Authentication',
      '',
      'step one do this thing',
      '',
      'step two do that thing',
      '',
      '## Deployment',
      '',
      'deploy step here now',
    ].join('\n');
    const chunks = chunkMarkdown(md, {
      maxTokens: 8, // 32 chars — multiple chunks
      overlap: 0,
      strategy: 'char',
    });
    expect(chunks.length).toBeGreaterThan(2);
    // The first chunk precedes any heading — headingContext is empty.
    expect(chunks[0].headingContext).toBe('');
    // At least one chunk under "Authentication" and one under "Deployment".
    const contexts = chunks.map(c => c.headingContext);
    expect(contexts).toContain('Authentication');
    expect(contexts).toContain('Deployment');
    // A heading context only changes after its heading block has been seen.
    const firstDeploy = contexts.indexOf('Deployment');
    expect(contexts.slice(firstDeploy)).toEqual(
      expect.arrayContaining(['Deployment']),
    );
    expect(contexts.slice(0, firstDeploy)).not.toContain('Deployment');
  });

  it('overlap>0 produces consecutive chunks whose overlap tail/head actually overlap', () => {
    const md = Array.from({ length: 12 }, (_, i) => `paragraph number ${i + 1} with words`).join(
      '\n\n',
    );
    const chunks = chunkMarkdown(md, {
      maxTokens: 20, // 80 chars — small enough to force several chunks
      overlap: 5, // 20 chars carried
      strategy: 'char',
    });
    expect(chunks.length).toBeGreaterThan(2);
    for (let i = 1; i < chunks.length; i++) {
      // The leading content of chunk N+1 (the overlap carried from chunk N)
      // must appear in chunk N's text. Prefix stays well inside the 20-char
      // overlap so it does not run past the carried tail into new content.
      const head = chunks[i].text.slice(0, 10);
      expect(chunks[i - 1].text).toContain(head);
    }
    // Overlap must not violate the hard cap.
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(20 * 4);
    }
  });

  it('does not exceed maxTokens when overlap approaches the budget', () => {
    const md = Array.from({ length: 20 }, () => 'word word word word').join('\n\n');
    const chunks = chunkMarkdown(md, {
      maxTokens: 5, // 20 chars
      overlap: 4, // 16 chars carried — close to the budget
      strategy: 'char',
    });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(5 * 4);
      expect(chunk.tokenCount).toBeLessThanOrEqual(5);
    }
  });

  it('terminates and emits chunks under maxTokens:1 (degenerate budget)', () => {
    const md = 'aaaa bbbb cccc dddd';
    const chunks = chunkMarkdown(md, {
      maxTokens: 1, // 4 chars
      overlap: 0,
      strategy: 'char',
    });
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(4);
    }
  });

  it('token totals are consistent with the input size', () => {
    const md = Array.from({ length: 8 }, (_, i) => `paragraph ${i + 1}`).join('\n\n');
    const chunks = chunkMarkdown(md, {
      maxTokens: 4,
      overlap: 0,
      strategy: 'char',
    });
    const sumChars = chunks.reduce((acc, c) => acc + c.text.length, 0);
    // Non-whitespace content from the input must survive across chunks; the
    // sum-of-chars is bounded below by the non-whitespace char count and above
    // by a small multiple (separators added at chunk boundaries).
    const nonWhitespace = md.replace(/\s+/g, '');
    const sumNonWhitespace = chunks
      .map(c => c.text.replace(/\s+/g, ''))
      .reduce((acc, s) => acc + s.length, 0);
    expect(sumNonWhitespace).toBe(nonWhitespace.length);
    expect(sumChars).toBeLessThan(md.length * 5);
  });

  describe('semantic strategy', () => {
    const para = (label: string) =>
      `${label} lorem ipsum dolor sit amet consectetur`;

    it('returns [] for empty input', () => {
      expect(
        chunkMarkdown('', { maxTokens: 100, overlap: 0, strategy: 'semantic' }),
      ).toEqual([]);
    });

    it('aligns chunks to heading boundaries when each section fits', () => {
      const md = [
        '## A',
        '',
        para('para A1'),
        '',
        para('para A2'),
        '',
        '## B',
        '',
        para('para B1'),
        '',
        para('para B2'),
        '',
        '### B1',
        '',
        para('para B1a'),
        '',
        para('para B1b'),
      ].join('\n');
      // maxChars=160: each section (~104/107 chars) fits, but all three
      // combined overflow — so each section lands in its own chunk.
      const chunks = chunkMarkdown(md, {
        maxTokens: 40,
        overlap: 0,
        strategy: 'semantic',
      });
      expect(chunks.length).toBe(3);
      // Every chunk starts at a heading (a fitting section is never split).
      for (const chunk of chunks) {
        expect(chunk.text.startsWith('#')).toBe(true);
      }
      // Chunk contexts follow the heading hierarchy in effect.
      expect(chunks[0].headingContext).toBe('A');
      expect(chunks[1].headingContext).toBe('B');
      expect(chunks[2].headingContext).toBe('B > B1');
      // No chunk splits a paragraph that belongs to a fitting section: each
      // paragraph appears whole inside exactly one chunk.
      for (const label of ['para A1', 'para A2', 'para B1', 'para B2', 'para B1a', 'para B1b']) {
        const owners = chunks.filter(c => c.text.includes(para(label)));
        expect(owners).toHaveLength(1);
      }
    });

    it('keeps a 50-line fenced code block intact when it fits the budget', () => {
      const code = [
        '```js',
        ...Array.from({ length: 50 }, (_, i) => `const x${i} = ${i};`),
        '```',
      ].join('\n');
      const md = ['# Title', '', 'intro paragraph', '', code, '', 'outro paragraph'].join('\n');
      const chunks = chunkMarkdown(md, {
        maxTokens: 500,
        overlap: 0,
        strategy: 'semantic',
      });
      expect(chunks).toHaveLength(1);
      // The whole opening-to-closing fence is inside the single chunk.
      const lines = chunks[0].text.split('\n');
      expect(lines).toContain('```js');
      expect(lines).toContain('```');
      expect(chunks[0].text).toContain('const x0 = 0;');
      expect(chunks[0].text).toContain('const x49 = 49;');
    });

    it('keeps an oversized fenced code block intact even though it exceeds maxTokens', () => {
      const code = [
        '```js',
        ...Array.from({ length: 50 }, (_, i) => `const x${i} = ${i};`),
        '```',
      ].join('\n');
      const md = ['# Title', '', 'intro paragraph', '', code, '', 'outro paragraph'].join('\n');
      // maxChars=160: the code block (~870 chars) alone overflows. Semantic
      // must NOT split the fence — it emits the block as its own chunk that
      // exceeds the budget, with both fences intact.
      const chunks = chunkMarkdown(md, {
        maxTokens: 40,
        overlap: 0,
        strategy: 'semantic',
      });
      // The oversized code block is its own chunk.
      const codeChunk = chunks.find(c => c.text.includes('```js'));
      expect(codeChunk).toBeDefined();
      expect(codeChunk!.text.startsWith('```js')).toBe(true);
      expect(codeChunk!.text.trim().endsWith('```')).toBe(true);
      // Deliberate tradeoff: it exceeds the budget rather than split the fence.
      expect(codeChunk!.text.length).toBeGreaterThan(40 * 4);
      // Surrounding paragraphs survive in their own chunks, unsplit.
      expect(chunks.some(c => c.text.includes('intro paragraph'))).toBe(true);
      expect(chunks.some(c => c.text.includes('outro paragraph'))).toBe(true);
    });

    it('carries the heading hierarchy path into headingContext', () => {
      const md = [
        '## A',
        '',
        'para under A which is long enough to fill a chunk on its own',
        '',
        '### A1',
        '',
        'para under A1 lorem ipsum dolor',
      ].join('\n');
      // maxChars=100: section A (~84 chars) fills a chunk, so A1 starts a new
      // chunk whose headingContext is the full "A > A1" hierarchy path.
      const chunks = chunkMarkdown(md, {
        maxTokens: 25,
        overlap: 0,
        strategy: 'semantic',
      });
      expect(chunks.length).toBe(2);
      expect(chunks[0].headingContext).toBe('A');
      expect(chunks[1].headingContext).toBe('A > A1');
    });

    it('section-aligns chunks under the default strategy via the schema', async () => {
      const { chunkTextInputSchema } = await import('../../src/tools/schemas.js');
      // The schema default flips to 'semantic' once CTX-3 lands.
      const parsed = chunkTextInputSchema.parse({ text: '## H\n\nbody' });
      expect(parsed.strategy).toBe('semantic');
    });

    it('overlap carries trailing text units as the next chunk prefix, never a code block', () => {
      const md = [
        '## Setup',
        '',
        'ctx one',
        '',
        'ctx two',
        '',
        '```bash',
        'echo one',
        '```',
        '',
        '## Next',
        '',
        'after',
      ].join('\n');
      // maxChars=48: the Setup section (heading + two short paragraphs + a
      // bash fence, ~47 chars) fits as one chunk ending in a code block; the
      // Next section starts a second chunk. With overlap=5 (20 chars), the
      // carrier must skip the trailing code block and bring forward the text
      // units preceding it — never the fence body itself.
      const chunks = chunkMarkdown(md, {
        maxTokens: 12,
        overlap: 5,
        strategy: 'semantic',
      });
      expect(chunks).toHaveLength(2);
      const nextChunk = chunks[1];
      // Carrier text from before the fence survives into the next chunk...
      expect(nextChunk.text).toContain('ctx one');
      expect(nextChunk.text).toContain('ctx two');
      // ...the fence body itself never carries.
      expect(nextChunk.text.startsWith('```')).toBe(false);
      expect(nextChunk.text).not.toContain('echo one');
      // headingContext still follows the chunk's own heading, not the carrier.
      expect(nextChunk.headingContext).toBe('Next');
    });
  });
});
