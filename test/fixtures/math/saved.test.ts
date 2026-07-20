import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractArticleFromHtml } from '../../../src/tools/extract.js';
import type { StructuredContent } from '../../../src/tools/output-schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, 'saved.html');
const pageUrl = 'https://docs.example.com/guides/math';

function payloadText(result: ReturnType<typeof extractArticleFromHtml>): string {
  const first = result.content[0];
  return first && 'text' in first ? first.text : '';
}

describe('math fixture: KaTeX, MathJax, and bare MathML round-trip to LaTeX', () => {
  it('recovers inline + display LaTeX from every engine without leaks', () => {
    const html = readFileSync(fixturePath, 'utf8');
    const result = extractArticleFromHtml({ html, baseUrl: pageUrl });
    expect(result.isError).toBeFalsy();

    const structured = result.structuredContent as StructuredContent;
    expect(structured.diagnostics.fallbackUsed).toBe(false);

    const text = payloadText(result);
    // KaTeX inline annotation -> inline math.
    expect(text).toContain('$E = mc^2$');
    // KaTeX display annotation -> display math; backslashes preserved.
    expect(text).toContain('$$\\int_0^\\infty e^{-x}\\,dx$$');
    // Bare MathML inline annotation (arXiv/MDN) -> inline math.
    expect(text).toContain('$h_{t}$');
    // Bare MathML display annotation -> display math; backslashes preserved.
    expect(text).toContain('$$\\alpha + \\beta$$');
    // MathJax inline script -> inline math.
    expect(text).toContain('$a^2 + b^2 = c^2$');
    // MathJax display script -> display math.
    expect(text).toContain('$$\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$$');

    // Rendered KaTeX spans, MathML element characters, and semantic markup
    // must not leak into the markdown — the Greek `<mi>` glyphs and the
    // `x-tex` annotation encoding are the leak signals for bare MathML.
    expect(text).not.toContain('katex-html');
    expect(text).not.toContain('aria-hidden');
    expect(text).not.toContain('application/x-tex');
    expect(text).not.toContain('<math');
    expect(text).not.toContain('α');
    expect(text).not.toContain('β');
    // Turndown must not double the LaTeX backslashes.
    expect(text).not.toContain('\\\\int');
    expect(text).not.toContain('\\\\sum');
    expect(text).not.toContain('\\\\frac');
    expect(text).not.toContain('\\\\alpha');
  });
});

