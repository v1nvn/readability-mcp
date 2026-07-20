import { absolutize } from '../pipeline/urls.js';

export interface PaginationSignal {
  readonly nextUrl?: string;
  readonly selector?: string;
  readonly type: 'infinite' | 'paginated';
}

// Short pagination-style link text only; matching prose like "next, we cover
// rendering" would burn an article's internal link as a next-page signal.
// `next ›/»/→` and bare arrows cover the common next-page glyphs in one place.
const NEXT_LINK_TEXT_RE =
  /^(next(\s+page)?|older(\s+posts?)?|[›»→]|next\s*[›»→]|older\s*[›»→])$/i;

function usableHref(href: null | string): string | undefined {
  if (!href || href === '#') {
    return undefined;
  }
  return href;
}

function findPaginated(
  document: Document,
  baseUrl: string | undefined,
): PaginationSignal | undefined {
  const linkNext = document.querySelector('link[rel="next"][href]');
  if (linkNext) {
    const href = usableHref(linkNext.getAttribute('href'));
    if (href) {
      return { type: 'paginated', nextUrl: absolutize(href, baseUrl) };
    }
  }

  const aRelNext = document.querySelector('a[rel="next"][href]');
  if (aRelNext) {
    const href = usableHref(aRelNext.getAttribute('href'));
    if (href) {
      return { type: 'paginated', nextUrl: absolutize(href, baseUrl) };
    }
  }

  for (const anchor of document.querySelectorAll('a[href]')) {
    const text = anchor.textContent.trim();
    if (!text || !NEXT_LINK_TEXT_RE.test(text)) {
      continue;
    }
    const href = usableHref(anchor.getAttribute('href'));
    if (!href) {
      continue;
    }
    return { type: 'paginated', nextUrl: absolutize(href, baseUrl) };
  }

  return undefined;
}

const INFINITE_ATTR_SELECTORS = [
  '[data-load-more]',
  '[data-infinite-scroll]',
  '[data-pagination]',
  '[infinite-scroll]',
] as const;

const INFINITE_SUBSTRING_SELECTORS = [
  '[class*="load-more"]',
  '[class*="loadmore"]',
  '[class*="infinite"]',
  '[id*="load-more"]',
  '[class*="sentinel"]',
] as const;

const LOAD_MORE_BUTTON_RE =
  /^(load more|show more|view more|more results|load more comments)$/i;

function findInfinite(document: Document): PaginationSignal | undefined {
  for (const selector of INFINITE_ATTR_SELECTORS) {
    const el = document.querySelector(selector);
    if (el?.isConnected) {
      return { selector, type: 'infinite' };
    }
  }
  for (const selector of INFINITE_SUBSTRING_SELECTORS) {
    const el = document.querySelector(selector);
    if (el?.isConnected) {
      return { selector, type: 'infinite' };
    }
  }
  for (const button of document.querySelectorAll('button')) {
    const text = button.textContent.trim();
    if (text && LOAD_MORE_BUTTON_RE.test(text)) {
      return { selector: 'button', type: 'infinite' };
    }
  }
  return undefined;
}

// Paginated beats infinite: an explicit "next" link is a stronger signal than
// a load-more sentinel. Read-only — never follows or fetches.
export function detectPagination(
  document: Document,
  baseUrl?: string,
): PaginationSignal | undefined {
  return findPaginated(document, baseUrl) ?? findInfinite(document);
}
