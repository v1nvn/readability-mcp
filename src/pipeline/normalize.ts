import { extractMath } from '../policy/math.js';
import { KNOWN_LANGUAGE_TOKENS } from '../policy/resolver.js';

const NONCE_ATTR = 'nonce';

export interface NormalizeCounts {
  readonly boilerplateRemoved: number;
  readonly chromeRemoved: number;
  readonly iframes: number;
  readonly scripts: number;
}

export interface NormalizeOptions {
  readonly cleanChrome?: boolean;
}

export function normalizeDocument(
  document: Document,
  options?: NormalizeOptions,
): NormalizeCounts {
  // MathJax source lives in `<script type="math/tex">`, which the script-removal
  // loop below strips — extract math into markers first so both engines share
  // one turndown rule downstream.
  extractMath(document);

  const baseEls = document.querySelectorAll('base');
  // Preserve <script type="application/ld+json">: structured metadata consumed by the cascade.
  const scriptEls = document.querySelectorAll(
    'script:not([type="application/ld+json"])',
  );

  baseEls.forEach(el => {
    el.remove();
  });
  scriptEls.forEach(el => {
    el.remove();
  });

  const withNonce = document.querySelectorAll(`[${NONCE_ATTR}]`);
  withNonce.forEach(el => {
    el.removeAttribute(NONCE_ATTR);
  });

  const chromeRemoved =
    options?.cleanChrome === false ? 0 : stripChrome(document);

  const boilerplateRemoved = stripBoilerplate(document);

  return {
    boilerplateRemoved,
    chromeRemoved,
    iframes: 0,
    scripts: scriptEls.length,
  };
}

// Conservative, vendor-specific consent SDK selectors. Curated, not greedy —
// intentionally NOT `[class*="consent"]` (that eats real article widgets).
const CONSENT_SELECTORS = [
  '[role="dialog"]',
  '[aria-modal="true"]',
  '#onetrust-banner-sdk',
  '#onetrust-consent-sdk',
  '#onetrust-pc-sdk',
  '.cc-window',
  '.cc-banner',
  '.cc-revoke',
  '.osano-cm-window',
  '.osano-cm-dialog',
  '.qc-cmp2-container',
  '.qc-cmp-ui-container',
  '#sp_message_container',
  '[id^="sp_message_container_"]',
  '#didomi-host',
  '.didomi-popup-container',
  '#truste-consent-track',
  '#consent_blackbar',
  '#cookie-banner',
  '.cookie-banner',
  '#consent-banner',
  '.consent-banner',
  '.cookie-bar',
  '.gdpr-banner',
  '.privacy-banner',
];

// jsdom has no layout, so "covers the viewport" must be inferred from inline
// style. Requiring BOTH axes full is what protects a fixed nav bar: a nav is
// full-width but its height is a fixed px (not 100%/100vh), and inset:0 is not
// used. Dropping either axis from the conjunction nukes legit chrome.
function isFullViewportOverlay(style: string): boolean {
  if (!/position\s*:\s*(?:fixed|sticky)/i.test(style)) {
    return false;
  }
  const zIndexMatch = /z-index\s*:\s*(\d+)/i.exec(style);
  if (!zIndexMatch || Number.parseInt(zIndexMatch[1], 10) < 1000) {
    return false;
  }
  // `inset:0` is shorthand for top/right/bottom/left = 0, so it satisfies BOTH
  // axes at once and is checked up front.
  if (/inset\s*:\s*0/i.test(style)) {
    return true;
  }
  const widthFull =
    /width\s*:\s*100(?:%|vw)/i.test(style) ||
    (/left\s*:\s*0/i.test(style) && /right\s*:\s*0/i.test(style));
  const heightFull =
    /height\s*:\s*100(?:%|vh)/i.test(style) ||
    (/top\s*:\s*0/i.test(style) && /bottom\s*:\s*0/i.test(style));
  return widthFull && heightFull;
}

// Removes before Readability scores them — these poison density math and leak
// into the article. Inline-style matches require the full isFullViewportOverlay
// conjunction; `position:fixed` alone never qualifies.
export function stripChrome(document: Document): number {
  let removed = 0;

  const consentEls = document.querySelectorAll(CONSENT_SELECTORS.join(','));
  for (const el of consentEls) {
    if (!el.isConnected) {
      continue;
    }
    el.remove();
    removed++;
  }

  const styledEls = document.querySelectorAll('[style]');
  for (const el of styledEls) {
    if (!el.isConnected) {
      continue;
    }
    if (isFullViewportOverlay(el.getAttribute('style') ?? '')) {
      el.remove();
      removed++;
    }
  }

  return removed;
}

// Unambiguous boilerplate signatures. Bare `related`/`subscribe` are
// intentionally excluded — they match legit content (related-products section
// on a store, a "subscribe to RSS" line inside an article) far too often.
// Substring matching means `newsletter` also covers `newsletter-signup`, etc.;
// the longer spellings are kept as explicit documentation of intended targets.
const BOILERPLATE_TOKENS = [
  'newsletter',
  'newsletter-signup',
  'mailing-list',
  'email-signup',
  'subscribe-form',
  'signup-form',
  'related-posts',
  'related-post',
  'read-next',
  'more-from',
  'you-might-also',
  'recommended-posts',
  'recommended',
];

function signatureMatches(el: Element): boolean {
  const signature =
    `${el.getAttribute('class') ?? ''} ${el.getAttribute('id') ?? ''}`.toLowerCase();
  return BOILERPLATE_TOKENS.some(token => signature.includes(token));
}

// A boilerplate block is always a structural CONTAINER. A heading or paragraph
// can carry a token in its `id` (an anchor target like `id="related-posts"`) or
// `class`, and individually such a leaf passes the footprint guard — so without
// a container restriction the rule deletes real article content (e.g. an in-body
// section heading whose id happens to match). Reject non-containers early.
const BOILERPLATE_CONTAINER_TAGS = new Set([
  'ASIDE',
  'DIV',
  'FORM',
  'NAV',
  'OL',
  'SECTION',
  'UL',
]);

// Strips "related posts" / newsletter signup / "read next" blocks Readability
// sometimes retains. Subtractive and high-risk, so a token hit alone is never
// enough: the footprint guard requires the candidate to be a small fraction of
// the body. The body length is snapshotted once so every candidate is judged
// against the same baseline — recomputing after each removal would make the
// threshold depend on iteration order. A boilerplate block is always a small
// slice of a real article; capping at 25% guarantees the worst case is leaving
// a small block in, never deleting a section that is itself a substantial part
// of the content. Idempotent and order-independent.
//
// Only outermost boilerplate roots are candidates. A single signature CONTAINER
// (e.g. <aside class="newsletter-subscribe">) puts the token on every descendant
// ("newsletter-title", "newsletter-submit", …); stripping those leaves
// independently mangles the container when the footprint guard preserves the
// root — a newsletter form shorn of its title and submit button. The ancestor
// walk rejects any element whose class+id already matched on an ancestor.
// querySelectorAll yields outer-before-inner order, and removing a root detaches
// its descendants (caught by !isConnected above), so this walk uniformly rejects
// leaves of both removed roots and preserved roots.
export function stripBoilerplate(document: Document): number {
  const bodyLength = document.body.textContent.length;
  const limit = 0.25 * bodyLength;

  let removed = 0;
  for (const el of document.querySelectorAll('[class],[id]')) {
    if (!el.isConnected) {
      continue;
    }
    if (!BOILERPLATE_CONTAINER_TAGS.has(el.tagName)) {
      continue;
    }
    if (!signatureMatches(el)) {
      continue;
    }
    let ancestor: Element | null = el.parentElement;
    while (ancestor && !signatureMatches(ancestor)) {
      ancestor = ancestor.parentElement;
    }
    if (ancestor) {
      continue;
    }
    if (el.textContent.length >= limit) {
      continue;
    }
    el.remove();
    removed++;
  }
  return removed;
}

export interface SelectorScope {
  readonly exclude?: readonly string[];
  readonly include?: string;
}

// Scope the document by CSS selector: drop every `exclude` match, then (if
// `include` matches) replace the body with the first matching subtree.
export function applySelectors(
  document: Document,
  selectors: SelectorScope | undefined,
): void {
  if (!selectors) {
    return;
  }
  if (selectors.exclude) {
    for (const selector of selectors.exclude) {
      document.querySelectorAll(selector).forEach(el => {
        el.remove();
      });
    }
  }
  if (selectors.include) {
    const body = document.body;
    const root = body.querySelector(selectors.include);
    if (root && root !== body) {
      body.innerHTML = '';
      body.appendChild(root);
    }
  }
}

// Matched anywhere in a src (case-insensitive) to flag a lazy-load placeholder.
const PLACEHOLDER_TOKENS = [
  'placeholder',
  'blank',
  'spacer',
  'lazy',
  'loading',
  '1x1',
  'transparent',
  'pixel',
  'dummy',
];

export function isPlaceholderSrc(src: string): boolean {
  if (!src) {
    return true;
  }
  if (src.startsWith('data:')) {
    return true;
  }
  const lowered = src.toLowerCase();
  return PLACEHOLDER_TOKENS.some(token => lowered.includes(token));
}

function usableAttr(el: Element, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = el.getAttribute(name);
    if (value) {
      return value;
    }
  }
  return undefined;
}

// Largest-descriptor candidate wins (`Nw`/`Nx`, never mixed in valid srcset);
// first candidate wins when none carry a descriptor. Malformed entries are skipped.
function pickLargestSrcset(srcset: string): string | undefined {
  let bestUrl: string | undefined;
  let bestValue = -1;
  let firstUrl: string | undefined;
  let sawDescriptor = false;
  for (const raw of srcset.split(',')) {
    const entry = raw.trim();
    if (!entry) {
      continue;
    }
    const splitAt = entry.search(/\s/);
    const rawUrl = splitAt === -1 ? entry : entry.slice(0, splitAt);
    const descriptor = splitAt === -1 ? '' : entry.slice(splitAt).trim();
    const url =
      rawUrl.length >= 2 &&
      ((rawUrl.startsWith('"') && rawUrl.endsWith('"')) ||
        (rawUrl.startsWith("'") && rawUrl.endsWith("'")))
        ? rawUrl.slice(1, -1)
        : rawUrl;
    if (!url) {
      continue;
    }
    if (firstUrl === undefined) {
      firstUrl = url;
    }
    if (!descriptor) {
      continue;
    }
    const value = /^(\d+(?:\.\d+)?)[wx]$/.exec(descriptor);
    if (!value) {
      continue;
    }
    sawDescriptor = true;
    const numeric = Number.parseFloat(value[1]);
    if (numeric > bestValue) {
      bestValue = numeric;
      bestUrl = url;
    }
  }
  return sawDescriptor ? bestUrl : firstUrl;
}

// Skip media-constrained <source>: art-direction crops for specific viewports,
// not the default image the page shows.
function resolveFromPicture(img: HTMLImageElement): string | undefined {
  const picture = img.closest('picture');
  if (!picture) {
    return undefined;
  }
  for (const source of picture.querySelectorAll('source')) {
    if (source.hasAttribute('media')) {
      continue;
    }
    const srcset = source.getAttribute('srcset');
    if (srcset) {
      const url = pickLargestSrcset(srcset);
      if (url) {
        return url;
      }
    }
  }
  return undefined;
}

// Precedence (first usable wins): data-src → <picture><source srcset> → own
// srcset (largest) → data-original → data-lazy-src.
function resolveRealSource(img: HTMLImageElement): string | undefined {
  const dataSrc = usableAttr(img, ['data-src']);
  if (dataSrc) {
    return dataSrc;
  }
  const fromPicture = resolveFromPicture(img);
  if (fromPicture) {
    return fromPicture;
  }
  const ownSrcset = img.getAttribute('srcset');
  if (ownSrcset) {
    const url = pickLargestSrcset(ownSrcset);
    if (url) {
      return url;
    }
  }
  return usableAttr(img, ['data-original', 'data-lazy-src']);
}

// Swap placeholder src values for the real source before Readability clones.
// Only a placeholder-like current src is rewritten, so a real src is left alone
// even if a data-src also exists. Idempotent.
export function resolveLazyImages(document: Document): number {
  let resolved = 0;
  for (const img of document.querySelectorAll('img')) {
    const currentSrc = img.getAttribute('src') ?? '';
    if (!isPlaceholderSrc(currentSrc)) {
      continue;
    }
    const real = resolveRealSource(img);
    if (real && real !== currentSrc) {
      img.setAttribute('src', real);
      resolved++;
    }
  }
  return resolved;
}

// Readability keeps a class only by literal `classesToPreserve.includes(cls)`
// equality, so non-canonical code-block conventions — GitHub's
// `highlight-source-js`, sandpack's `sp-javascript`, SyntaxHighlighter's
// `brush: js` — are stripped before turndown runs and the fence loses its
// language tag. Rewrite each convention to the canonical
// `<code class="language-X">` form before Readability clones the document.
const HIGHLIGHT_SOURCE_PREFIX = 'highlight-source-';
const LANGUAGE_PREFIX = 'language-';
const LANG_PREFIX = 'lang-';
const SP_PREFIX = 'sp-';
const BRUSH_RE = /brush:\s*([A-Za-z][\w-]*)/;
const BOGUS_TOKENS = new Set(['', 'highlight', 'source', 'sp']);

interface CodeToken {
  readonly fromHighlightSource: boolean;
  readonly token: string;
}

function isValidToken(token: string): boolean {
  return !BOGUS_TOKENS.has(token);
}

function hasLanguageClass(el: Element): boolean {
  for (const cls of el.classList) {
    if (cls !== LANGUAGE_PREFIX && cls.startsWith(LANGUAGE_PREFIX)) {
      return true;
    }
  }
  return false;
}

interface ClassSource {
  readonly classes: readonly string[];
  readonly raw: string;
}

// Pool the <pre>'s own classes, then ancestors up to the highlight wrapper
// (capped at two levels), then any descendant <code>'s classes — in that order.
function collectClassSources(
  pre: Element,
  code: Element | null,
): ClassSource[] {
  const sources: ClassSource[] = [
    { classes: [...pre.classList], raw: pre.getAttribute('class') ?? '' },
  ];
  let depth = 0;
  let el: Element | null = pre.parentElement;
  while (el && depth < 2) {
    sources.push({
      classes: [...el.classList],
      raw: el.getAttribute('class') ?? '',
    });
    depth++;
    if (
      el.tagName === 'DIV' &&
      [...el.classList].some(c => c.startsWith('highlight'))
    ) {
      break;
    }
    el = el.parentElement;
  }
  if (code) {
    sources.push({
      classes: [...code.classList],
      raw: code.getAttribute('class') ?? '',
    });
  }
  return sources;
}

function resolveCodeToken(
  pre: Element,
  code: Element | null,
): CodeToken | null {
  const sources = collectClassSources(pre, code);

  function findByPrefix(prefix: string): null | string {
    for (const src of sources) {
      for (const cls of src.classes) {
        if (cls.startsWith(prefix)) {
          const token = cls.slice(prefix.length).toLowerCase();
          if (isValidToken(token)) {
            return token;
          }
        }
      }
    }
    return null;
  }

  // Convention priority: highlight-source > language > lang > sp > brush.
  // `brush:` is a class-attribute value, not a single class token, so it cannot
  // be matched by prefix and is parsed from the raw attribute string instead.
  const highlightToken = findByPrefix(HIGHLIGHT_SOURCE_PREFIX);
  if (highlightToken) {
    return { token: highlightToken, fromHighlightSource: true };
  }
  const languageToken = findByPrefix(LANGUAGE_PREFIX);
  if (languageToken) {
    return { token: languageToken, fromHighlightSource: false };
  }
  const langToken = findByPrefix(LANG_PREFIX);
  if (langToken) {
    return { token: langToken, fromHighlightSource: false };
  }
  // Sandpack emits infra classes alongside the language class (sp-cm,
  // sp-pristine, sp-pre-placeholder); unlike the single-token highlight-source
  // / language / lang conventions, SP must pick the class whose token is a
  // recognized language or it grabs an infra string the preserve list strips.
  for (const src of sources) {
    for (const cls of src.classes) {
      if (!cls.startsWith(SP_PREFIX)) {
        continue;
      }
      const token = cls.slice(SP_PREFIX.length).toLowerCase();
      if (KNOWN_LANGUAGE_TOKENS.has(token)) {
        return { token, fromHighlightSource: false };
      }
    }
  }
  for (const src of sources) {
    const match = BRUSH_RE.exec(src.raw);
    if (match) {
      const token = match[1].toLowerCase();
      if (isValidToken(token)) {
        return { token, fromHighlightSource: false };
      }
    }
  }
  return null;
}

function canonicalizePre(pre: Element): boolean {
  const code = pre.querySelector('code');
  // turndown reads the language from the <code> class; if one is present the
  // block is already canonical and rewriting it can only drop information.
  if (code && hasLanguageClass(code)) {
    return false;
  }
  const match = resolveCodeToken(pre, code);
  if (!match) {
    return false;
  }

  let target = code;
  if (!target) {
    target = pre.ownerDocument.createElement('code');
    while (pre.firstChild) {
      target.appendChild(pre.firstChild);
    }
    pre.appendChild(target);
  }

  const classes = [`language-${match.token}`];
  if (target.classList.contains('hljs')) {
    classes.push('hljs');
  }
  target.setAttribute('class', classes.join(' '));

  // GitHub carries the language on a <div class="highlight"> wrapper rather than
  // the <pre>; once that hint is moved onto <code>, hoist the <pre> out so the
  // block stands alone instead of inside a div Readability scores separately.
  if (match.fromHighlightSource) {
    const parent = pre.parentElement;
    if (
      parent?.tagName === 'DIV' &&
      [...parent.classList].some(c => c.startsWith('highlight'))
    ) {
      parent.replaceWith(pre);
    }
  }
  return true;
}

export function canonicalizeCodeBlocks(document: Document): number {
  let count = 0;
  for (const pre of document.querySelectorAll('pre')) {
    if (!pre.isConnected) {
      continue;
    }
    try {
      if (canonicalizePre(pre)) {
        count++;
      }
    } catch {
      // Defensive: malformed markup must not break the extract pipeline.
    }
  }
  return count;
}
