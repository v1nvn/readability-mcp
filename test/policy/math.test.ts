import { buildDocument } from '../../src/pipeline/dom.js';
import { extractMath } from '../../src/policy/math.js';

function markers(document: Document): HTMLElement[] {
  return Array.from(document.querySelectorAll('span.rdrm-math'));
}

describe('policy.math extractMath', () => {
  it('extracts inline KaTeX LaTeX from the x-tex annotation', () => {
    const { document } = buildDocument(
      '<html><body><p><span class="katex"><span class="katex-mathml"><math><semantics><mrow><mi>x</mi></mrow><annotation encoding="application/x-tex">a^2 + b^2</annotation></semantics></math></span><span class="katex-html" aria-hidden="true"><span class="base">rendered</span></span></span></p></body></html>',
    );
    extractMath(document);
    const ms = markers(document);
    expect(ms).toHaveLength(1);
    expect(ms[0]!.getAttribute('data-display')).toBe('false');
    expect(ms[0]!.textContent).toBe('a^2 + b^2');
    // The rendered .katex-html tree is gone.
    expect(document.querySelector('.katex-html')).toBeNull();
    expect(document.querySelector('annotation')).toBeNull();
  });

  it('detects KaTeX display math via the .katex-display wrapper', () => {
    const { document } = buildDocument(
      '<html><body><div class="katex-display"><span class="katex"><span class="katex-mathml"><math><semantics><mrow></mrow><annotation encoding="application/x-tex">\\int_0^\\infty</annotation></semantics></math></span><span class="katex-html" aria-hidden="true"></span></span></div></body></html>',
    );
    extractMath(document);
    const marker = document.querySelector('span.rdrm-math');
    expect(marker?.getAttribute('data-display')).toBe('true');
    expect(marker?.textContent).toBe('\\int_0^\\infty');
    // The .katex-display wrapper stays in place to preserve block context.
    expect(document.querySelector('.katex-display')).not.toBeNull();
  });

  it('extracts MathJax inline vs display script source', () => {
    const { document } = buildDocument(
      '<html><body>' +
        '<p>inline: <script type="math/tex">x = y</script></p>' +
        '<p>display: <script type="math/tex; mode=display">\\sum_{i=1}^{n} i</script></p>' +
        '</body></html>',
    );
    extractMath(document);
    const ms = markers(document);
    expect(ms).toHaveLength(2);
    expect(ms[0]!.getAttribute('data-display')).toBe('false');
    expect(ms[0]!.textContent).toBe('x = y');
    expect(ms[1]!.getAttribute('data-display')).toBe('true');
    expect(ms[1]!.textContent).toBe('\\sum_{i=1}^{n} i');
    // MathJax source scripts are gone (replaced, not left to be stripped).
    expect(document.querySelectorAll('script[type^="math/tex"]')).toHaveLength(
      0,
    );
  });

  it('falls back to a placeholder when a .katex has no annotation', () => {
    const { document } = buildDocument(
      '<html><body><span class="katex"><span class="katex-html" aria-hidden="true"><span class="base">rendered-only</span></span></span></body></html>',
    );
    extractMath(document);
    const marker = document.querySelector('span.rdrm-math');
    // No annotation → marker is still emitted with the placeholder, never null.
    expect(marker).not.toBeNull();
    expect(marker?.textContent).toBe('[?]');
    expect(document.querySelector('.katex-html')).toBeNull();
  });

  it('is idempotent — a second pass emits nothing new', () => {
    const { document } = buildDocument(
      '<html><body><span class="katex"><span class="katex-mathml"><math><semantics><annotation encoding="application/x-tex">x</annotation></semantics></math></span><span class="katex-html"></span></span></body></html>',
    );
    extractMath(document);
    const firstPass = markers(document);
    expect(firstPass).toHaveLength(1);
    extractMath(document);
    const secondPass = markers(document);
    expect(secondPass).toHaveLength(1);
    expect(secondPass[0]).toBe(firstPass[0]);
  });

  it('extracts bare-MathML inline LaTeX and drops the <math> element', () => {
    const { document } = buildDocument(
      '<html><body><p>At each step <math display="inline" class="ltx_Math" alttext="h_{t}"><semantics><mrow><msub><mi>h</mi><mi>t</mi></msub></mrow><annotation encoding="application/x-tex">h_{t}</annotation></semantics></math> depends.</p></body></html>',
    );
    extractMath(document);
    const ms = markers(document);
    expect(ms).toHaveLength(1);
    expect(ms[0]!.getAttribute('data-display')).toBe('false');
    expect(ms[0]!.textContent).toBe('h_{t}');
    // The bare <math> container is replaced, so neither it nor the rendered
    // <mi> characters survive into turndown.
    expect(document.querySelector('math')).toBeNull();
    expect(document.querySelector('annotation')).toBeNull();
    expect(document.body.textContent).toContain('h_{t}');
  });

  it('detects bare-MathML display math via display="block"', () => {
    const { document } = buildDocument(
      '<html><body><div class="ltx_equation"><math display="block" alttext="\\alpha + \\beta"><semantics><mrow><mi>α</mi><mo>+</mo><mi>β</mi></mrow><annotation encoding="application/x-tex">\\alpha + \\beta</annotation></semantics></math></div></body></html>',
    );
    extractMath(document);
    const marker = document.querySelector('span.rdrm-math');
    expect(marker?.getAttribute('data-display')).toBe('true');
    expect(marker?.textContent).toBe('\\alpha + \\beta');
    expect(document.querySelector('math')).toBeNull();
    // Rendered MathML element characters do not leak.
    expect(document.body.textContent).not.toContain('α');
  });

  it('falls back to <math alttext> when the annotation text is empty', () => {
    const { document } = buildDocument(
      '<html><body><math display="inline" alttext="x + 1"><semantics><mrow><mi>x</mi></mrow><annotation encoding="application/x-tex"></annotation></semantics></math></body></html>',
    );
    extractMath(document);
    const marker = document.querySelector('span.rdrm-math');
    expect(marker?.getAttribute('data-display')).toBe('false');
    expect(marker?.textContent).toBe('x + 1');
    expect(document.querySelector('math')).toBeNull();
  });
});
