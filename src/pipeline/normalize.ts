// Pre-Readability normalization (DESIGN §6.3). Runs on the dom-stage document
// (owned by the pipeline, not by the caller) and removes noise that hijacks
// extraction or absolutization:
//   - <base href> — would override the `url` origin for relative link resolution.
//   - <script>    — dead weight for article extraction; DOMPurify strips them
//                   anyway, but dropping them here keeps the pre-sanitize
//                   document honest. Counted here so the diagnostics sum across
//                   the whole pipeline reflects every removed script/iframe
//                   (DESIGN §5.1 sanitization counts), not just DOMPurify's cut.
//   - nonce=""    — CSP nonces are per-request volatile noise, never article content.
// Readability mutates its input, so the readability stage clones before parsing;
// this function mutates the document in place.

const NONCE_ATTR = 'nonce';

// What normalize removed, in the same vocabulary as DOMPurify's counts so the
// two can be summed into `diagnostics.sanitization`. `iframes` is always 0 here
// today — normalize only strips scripts; iframes are left for DOMPurify — but
// the field exists so the shape is uniform and a future change is a one-liner.
export interface NormalizeCounts {
  readonly iframes: number;
  readonly scripts: number;
}

export function normalizeDocument(document: Document): NormalizeCounts {
  const baseEls = document.querySelectorAll('base');
  // Remove executable scripts, but PRESERVE `<script type="application/ld+json">`:
  // those carry structured metadata consumed by the metadata cascade, and they
  // live in <head> so they never reach the article-HTML sanitize path anyway.
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

  return { iframes: 0, scripts: scriptEls.length };
}

// Optional selector-driven pruning before Readability: `exclude` strips nodes
// the caller knows are boilerplate (nav, footer, [role=banner], …). Applied
// after normalize so it operates on the cleaned tree.
export function applySelectorExclude(
  document: Document,
  exclude: readonly string[],
): number {
  let removed = 0;
  for (const selector of exclude) {
    const matches = document.querySelectorAll(selector);
    removed += matches.length;
    matches.forEach(el => {
      el.remove();
    });
  }
  return removed;
}

// Tokens that mark a src as a lazy-load placeholder rather than the real image.
// Matched case-insensitively anywhere in the src so they catch both path segments
// (`/static/spacer.gif`) and data-URI schemes. A real photo URL is unlikely to
// contain any of these, so the false-positive risk is low; over-matching here
// only matters when a usable replacement source also exists.
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

function isPlaceholderSrc(src: string): boolean {
  if (!src) {
    return true;
  }
  if (src.startsWith('data:')) {
    return true;
  }
  const lowered = src.toLowerCase();
  return PLACEHOLDER_TOKENS.some(token => lowered.includes(token));
}

// First non-empty value among the given attribute reads, else undefined.
function usableAttr(el: Element, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = el.getAttribute(name);
    if (value) {
      return value;
    }
  }
  return undefined;
}

// Pick the best URL from a srcset: the candidate with the largest descriptor
// (`Nw` width or `Nx` density — never mixed in valid srcset, so the numeric
// comparison is unambiguous). If no candidate carries a descriptor, the first
// candidate wins per the srcset fallback convention. Malformed entries are
// skipped rather than thrown on.
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
    // URL is the leading non-space token; the rest (after the first space) is
    // the optional `Nw`/`Nx` descriptor.
    const splitAt = entry.search(/\s/);
    const rawUrl = splitAt === -1 ? entry : entry.slice(0, splitAt);
    const descriptor = splitAt === -1 ? '' : entry.slice(splitAt).trim();
    // Strip a single pair of surrounding quotes per the srcset spec.
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

// For a <picture>-nested <img>, take the largest candidate from the first
// <source srcset> that has no `media` constraint. media-constrained sources are
// art-direction overrides for specific viewports, not the default image, so they
// are skipped to avoid picking a crop the page never shows at default size.
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

// Resolve the real source for an <img> holding a placeholder src. Precedence
// (first usable wins): data-src → <picture><source srcset> → the img own srcset
// (largest candidate) → data-original → data-lazy-src.
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

// Swap lazy-load placeholder src values for the real source BEFORE Readability
// clones the document. SPAs routinely ship a 1x1/transparent gif as <img src>
// and stash the real URL in data-*/srcset/<source>; without resolution every
// image in the output Markdown is broken. Only a placeholder-like current src is
// rewritten — a real src is left untouched even if a data-src also exists, which
// keeps the swap conservative. Returns the number of src values actually changed
// (idempotent: a resolved src is not placeholder-like, so a second run reports 0).
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
