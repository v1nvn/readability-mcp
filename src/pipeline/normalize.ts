const NONCE_ATTR = 'nonce';

export interface NormalizeCounts {
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

  return { chromeRemoved, iframes: 0, scripts: scriptEls.length };
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
