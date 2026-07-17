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
});
