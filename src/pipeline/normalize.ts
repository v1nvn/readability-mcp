const NONCE_ATTR = 'nonce';

export interface NormalizeCounts {
  readonly iframes: number;
  readonly scripts: number;
}

export function normalizeDocument(document: Document): NormalizeCounts {
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

  return { iframes: 0, scripts: scriptEls.length };
}

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
