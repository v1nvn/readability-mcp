export interface GatingSignal {
  readonly likely: boolean;
  readonly reason: string;
}

// Curated vendor/structural paywall selectors — intentionally NOT a greedy
// `[class*="subscribe"]` (that catches newsletter CTAs on clean articles and
// false-positives). Each entry names a known paywall surface.
const PAYWALL_SELECTORS = [
  '[class*="paywall"]',
  '[id*="paywall"]',
  '.piano',
  '#piano',
  '.tp-modal',
  '.tp-active',
  '[id*="piano"]',
  '[class*="piano"]',
  '[class*="subscribe-wall"]',
  '[id*="subscribe-wall"]',
  '[class*="metered-wall"]',
  '[id*="metered-wall"]',
  '.leaky-paywall',
] as const;

// Phrases that essentially never appear on a fully-unlocked article. Bare
// "Subscribe" nav links / newsletter CTAs are intentionally excluded — they
// are ubiquitous and would mislead the host into discarding complete content.
const METERED_TEXT_RE =
  /(\d+)\s*(?:free\s*)?(?:articles?|stories?)\s*(?:left|remaining)|you\s+have\s+reached\s+(?:your\s+)?(?:free\s+)?(?:article\s+|story\s+)?limit|subscribe\s+to\s+(?:continue\s+)?reading|read\s+the\s+full\s+(?:article|story)|unlock\s+(?:this|full|all)\s+(?:article|story|content)|keep\s+reading\s+with/i;

function findPaywallOverlay(document: Document): GatingSignal | undefined {
  for (const selector of PAYWALL_SELECTORS) {
    const el = document.querySelector(selector);
    if (el?.isConnected) {
      return { likely: true, reason: 'paywall overlay' };
    }
  }
  return undefined;
}

// One textContent read is cheaper than a per-element scan of a large doc and
// avoids ordering a query per selector. jsdom computes body.textContent once.
function findMeteredMessage(document: Document): GatingSignal | undefined {
  const text = document.body.textContent;
  if (METERED_TEXT_RE.test(text)) {
    return { likely: true, reason: 'metered paywall message' };
  }
  return undefined;
}

// Reads the DOM only — never fetches, authenticates, or mutates the document.
// Conservative by design: a false positive misleads the host into treating
// complete content as truncated, which is worse than a miss.
export function detectGating(document: Document): GatingSignal | undefined {
  return findPaywallOverlay(document) ?? findMeteredMessage(document);
}
