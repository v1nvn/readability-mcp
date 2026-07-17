// Math renderers leave the original LaTeX in a small, engine-agnostic pocket:
// the `<annotation encoding="application/x-tex">` child of a `<math>` element.
// KaTeX wraps it inside `.katex`, arXiv/LaTeXML (ar5iv) and MDN ship it in a
// bare `<math display="…">`, and MathJax v2/v3 do not use `<annotation>` at
// all — their source lives in `<script type="math/tex">` that the
// script-removal pass strips. Move each into one controlled marker span BEFORE
// normalize's `<script>` removal so every engine shares a single turndown rule
// that emits the LaTeX verbatim.

const MARKER_CLASS = 'rdrm-math';
const DISPLAY_ATTR = 'data-display';
const KATEX_CLASS = 'katex';
const KATEX_DISPLAY_CLASS = 'katex-display';
const TEX_ANNOTATION_SELECTOR = 'annotation[encoding="application/x-tex"]';
const MATHJAX_INLINE_TYPE = 'math/tex';
const MATHJAX_DISPLAY_TYPE = 'math/tex; mode=display';
// arXiv/LaTeXML (`ltx_*`) and common docs-site display-math wrappers. A bare
// `<math display="block">` also flags display, but pages often omit the
// attribute and signal block context only through the wrapper class.
const MATHML_DISPLAY_SELECTOR =
  '.ltx_equation, .ltx_displaymath, .equation-display, .math-display';
// Placeholder for a math container whose annotation and alttext are both empty
// or absent; rendered markup has no recoverable LaTeX, so emit a token rather
// than crash.
const BROKEN_PLACEHOLDER = '[?]';

function createMarker(
  document: Document,
  tex: string,
  display: boolean,
): HTMLElement {
  const marker = document.createElement('span');
  marker.className = MARKER_CLASS;
  marker.setAttribute(DISPLAY_ATTR, display ? 'true' : 'false');
  marker.textContent = tex;
  return marker;
}

// Drives off the annotation, not the wrapper, so one pass recovers LaTeX from
// every engine that emits `<annotation encoding="application/x-tex">` — KaTeX
// inside `.katex`, arXiv/MDN inside a bare `<math>`. The container replaced is
// engine-specific: the `.katex` span (which also drops the `.katex-html`
// rendered sibling), or the bare `<math>` element. Replacing a container
// detaches other annotations that lived inside it, so disconnected nodes
// reached later in document order are skipped. arXiv carries the LaTeX in
// `<math alttext="…">` as well, which is the fallback when the annotation text
// is empty.
function convertAnnotations(document: Document): void {
  const annotations = document.querySelectorAll(TEX_ANNOTATION_SELECTOR);
  for (const annotation of Array.from(annotations)) {
    if (!annotation.isConnected) {
      continue;
    }
    try {
      const katex = annotation.closest(`.${KATEX_CLASS}`);
      const math = annotation.closest('math');
      let container: Element = annotation;
      let display = false;
      if (katex) {
        container = katex;
        display = katex.closest(`.${KATEX_DISPLAY_CLASS}`) !== null;
      } else if (math) {
        container = math;
        display =
          math.getAttribute('display') === 'block' ||
          math.closest(MATHML_DISPLAY_SELECTOR) !== null;
      }
      const tex =
        annotation.textContent.trim() ||
        (math?.getAttribute('alttext') ?? '').trim();
      container.replaceWith(
        createMarker(document, tex || BROKEN_PLACEHOLDER, display),
      );
    } catch {
      annotation.replaceWith(createMarker(document, BROKEN_PLACEHOLDER, false));
    }
  }
}

// A `.katex` that survived the annotation pass had no recoverable annotation
// (stripped or never present). Its `.katex-html` rendered tree carries no
// recoverable LaTeX, so swap the whole span for a placeholder marker rather
// than let rendered spans leak into turndown.
function convertOrphanedKatex(document: Document): void {
  for (const katex of Array.from(
    document.getElementsByClassName(KATEX_CLASS),
  )) {
    if (!katex.isConnected) {
      continue;
    }
    try {
      const display = katex.closest(`.${KATEX_DISPLAY_CLASS}`) !== null;
      katex.replaceWith(createMarker(document, BROKEN_PLACEHOLDER, display));
    } catch {
      // Defensive: malformed markup must not break the extract pipeline.
    }
  }
}

// MathJax v2/v3 inline + display source scripts. These `<script>` nodes are
// removed by normalize's generic script-removal AND by DOMPurify, so they must
// be converted here, before that loop runs. MathJax scripts do not use
// `<annotation>`, so they are handled separately from `convertAnnotations`.
function convertMathJax(document: Document): void {
  const scripts = document.querySelectorAll(
    `script[type="${MATHJAX_INLINE_TYPE}"], script[type="${MATHJAX_DISPLAY_TYPE}"]`,
  );
  for (const script of Array.from(scripts)) {
    if (!script.isConnected) {
      continue;
    }
    try {
      const rawType = script.getAttribute('type') ?? '';
      const display = rawType.includes('mode=display');
      const tex = script.textContent.trim();
      script.replaceWith(
        createMarker(document, tex || BROKEN_PLACEHOLDER, display),
      );
    } catch {
      script.replaceWith(createMarker(document, BROKEN_PLACEHOLDER, false));
    }
  }
}

// Walks the pre-normalize document and rewrites every math container —
// annotation-bearing (KaTeX, bare MathML) or MathJax script — into a
// `<span class="rdrm-math" data-display="…">LATEX</span>` marker. Idempotent:
// markers carry no `.katex`/`<math>`/annotation, so a second pass is a no-op.
// Defensive per node so malformed markup never aborts the pass.
export function extractMath(document: Document): void {
  convertAnnotations(document);
  convertOrphanedKatex(document);
  convertMathJax(document);
}
