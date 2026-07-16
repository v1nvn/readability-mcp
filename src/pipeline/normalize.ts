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
