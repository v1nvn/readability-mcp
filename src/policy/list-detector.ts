import { isElement } from '../pipeline/dom.js';
import { absolutize } from '../pipeline/urls.js';

export interface ListItem {
  readonly score: number;
  readonly snippet: string;
  readonly title: string;
  readonly url: string;
}

export type ListConfidence = 'high' | 'low' | 'medium';

export interface ListDetectionResult {
  readonly confidence: ListConfidence;
  readonly containerSelector: string;
  readonly detected: boolean;
  readonly itemCount: number;
  readonly items: readonly ListItem[];
  readonly itemTag: string;
  readonly note: string;
}

// Three siblings of the same shape (tag + class signature), each carrying a
// real navigation anchor, is the smallest cluster that is not accidentally a
// nav menu or a article's <ul> of inline links. Below this the detector
// refuses to claim the page is a list.
const MIN_ITEMS = 3;

// Six-or-more items with non-trivial body text per item is the empirical
// signature of a true index/search/blog-roll page (HN shows 30, Google ~10,
// WP indexes ~10). Used to separate `high` from `medium` confidence so a
// 3-item related-links block doesn't masquerade as a feed.
const HIGH_CONF_ITEMS = 6;
const HIGH_CONF_AVG_SCORE = 30;

const MAX_SNIPPET_CHARS = 200;

// Direct children are scanned only at these container levels. <tbody> covers
// HN's <table>-based layout; the rest cover semantic (<main>/<article>) and
// generic (<div>/<section>) list wrappers. <table> is included for HTML that
// skips <tbody>; jsdom synthesizes one anyway, so this is mostly defensive.
const CONTAINER_TAGS = new Set([
  'ARTICLE',
  'DIV',
  'MAIN',
  'OL',
  'SECTION',
  'TABLE',
  'TBODY',
  'UL',
]);

// Subtrees that never carry a page's primary item list. Stripping them is the
// false-positive guard: without it, an article's <nav> menu (3-6 short <li><a>
// items) would look identical to a feed and the detector would mis-fire on
// every article with a nav. List pages put their items in <main> or a top-level
// <table>, never inside chrome.
const CHROME_SELECTOR =
  'nav, header, footer, aside, [role="navigation"], [role="banner"], ' +
  '[role="contentinfo"], [role="complementary"], [role="search"], ' +
  '[role="menu"], [role="menubar"]';

// href schemes that don't point at a list target. Excluding them keeps mailto:
// /tel:/javascript:/ anchors from satisfying the "every item has a link" bar.
function isNavigationHref(href: string): boolean {
  if (!href || href === '#') {
    return false;
  }
  const lower = href.toLowerCase();
  return (
    !lower.startsWith('javascript:') &&
    !lower.startsWith('mailto:') &&
    !lower.startsWith('tel:')
  );
}

function anchorText(anchor: HTMLAnchorElement): string {
  return anchor.textContent.replace(/\s+/g, ' ').trim();
}

// Anchors with a navigation-worthy href AND visible text. Lives inside the
// candidate child so a single <a href="#"> footer link doesn't satisfy the
// "every item has a link" requirement.
function navigationAnchors(child: Element): HTMLAnchorElement[] {
  const anchors: HTMLAnchorElement[] = [];
  for (const el of child.querySelectorAll('a[href]')) {
    const anchor = el as HTMLAnchorElement;
    const href = anchor.getAttribute('href') ?? '';
    if (!isNavigationHref(href)) {
      continue;
    }
    if (anchorText(anchor).length === 0) {
      continue;
    }
    anchors.push(anchor);
  }
  return anchors;
}

// Composite of tag + class signature so HN's mixed siblings — <tr class="athing">
// (story title row) and classless <tr> (subtext row) — split into separate
// candidate groups; the title-bearing group then wins on score instead of
// producing half-junk items from the subtext rows.
function shapeKey(el: Element): string {
  const raw = el.getAttribute('class');
  if (!raw) {
    return el.tagName;
  }
  const normalized = raw.trim().split(/\s+/).sort().join(' ');
  return normalized ? `${el.tagName}|${normalized}` : el.tagName;
}

function describeSelector(el: Element): string {
  const parts = [el.tagName.toLowerCase()];
  const id = el.getAttribute('id');
  if (id) {
    parts.push(`#${id}`);
  }
  const cls = el.getAttribute('class');
  if (cls) {
    for (const token of cls.trim().split(/\s+/)) {
      if (token) {
        parts.push(`.${token}`);
      }
    }
  }
  return parts.join('');
}

function pickPrimaryAnchor(
  anchors: readonly HTMLAnchorElement[],
): HTMLAnchorElement {
  let primary = anchors[0];
  let best = anchorText(primary).length;
  for (let i = 1; i < anchors.length; i++) {
    const len = anchorText(anchors[i]).length;
    if (len > best) {
      primary = anchors[i];
      best = len;
    }
  }
  return primary;
}

function clipSnippet(raw: string): string {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= MAX_SNIPPET_CHARS) {
    return collapsed;
  }
  return `${collapsed.slice(0, MAX_SNIPPET_CHARS)}…`;
}

// Score = primary-anchor text length + non-link body text length. A pure
// link-density penalty (textLength * (1 - linkDensity)) ranks HN's subtext
// rows ABOVE the title rows because the title row is anchor-dominated (its
// title IS the link), so non-link body alone mis-ranks. Adding the primary
// anchor's text length rewards long titles (real feed items) over short nav
// labels ("Home", "Sign in"), which is the signal we actually want for both
// the candidate tiebreak and the high-confidence threshold.
function scoreItem(
  textLength: number,
  linkTextLength: number,
  primaryAnchorTextLength: number,
): number {
  if (textLength === 0) {
    return 0;
  }
  const nonLinkBody = Math.max(0, textLength - linkTextLength);
  return primaryAnchorTextLength + nonLinkBody;
}

function extractItem(
  child: Element,
  baseUrl: string | undefined,
): ListItem | null {
  const anchors = navigationAnchors(child);
  if (anchors.length === 0) {
    return null;
  }
  const primary = pickPrimaryAnchor(anchors);
  const title = anchorText(primary);
  if (!title) {
    return null;
  }
  const href = primary.getAttribute('href') ?? '';
  const url = absolutize(href, baseUrl);
  if (!url) {
    return null;
  }

  const fullText = child.textContent.replace(/\s+/g, ' ').trim();
  // Snippet = body text with the title peeled off the front when present, so
  // the title link doesn't echo into the excerpt.
  const snippet =
    fullText === title
      ? ''
      : fullText.startsWith(title)
        ? clipSnippet(fullText.slice(title.length + 1))
        : clipSnippet(fullText);

  const linkTextLength = anchors.reduce(
    (sum, anchor) => sum + anchorText(anchor).length,
    0,
  );
  return {
    score: scoreItem(fullText.length, linkTextLength, title.length),
    snippet,
    title,
    url,
  };
}

interface Candidate {
  readonly containerSelector: string;
  readonly distinctPathnames: number;
  readonly items: readonly ListItem[];
  readonly itemTag: string;
  readonly totalScore: number;
}

// Count of distinct URL pathnames a candidate's items point at. This is the
// signal that separates a real feed from a metadata cluster: a feed's items
// each navigate to a distinct destination (HN title rows link to ~30 different
// external stories; a blog index links to /post-1../post-N; a search results
// page links to a heterogeneous set of sites), so distinctPathnames ≈ item
// count. A metadata cluster's items all navigate to the same internal route —
// HN's subtext rows are 31 anchors all pointing at news.ycombinator.com/item?id=…,
// collapsing to pathname=/item (distinctPathnames = 1). Counting items alone
// lets subtext win on HN (31 vs 30 title rows) because of the trailing "More"
// row; counting distinct destinations restores the title group as the winner.
function distinctPathnames(items: readonly ListItem[]): number {
  const paths = new Set<string>();
  for (const item of items) {
    try {
      paths.add(new URL(item.url).pathname);
    } catch {
      paths.add(item.url);
    }
  }
  return paths.size;
}

function collectCandidates(document: Document, baseUrl: string | undefined) {
  const candidates: Candidate[] = [];
  for (const container of document.querySelectorAll('*')) {
    if (!CONTAINER_TAGS.has(container.tagName)) {
      continue;
    }
    // Group direct element-children by shape so homogeneous sibling lists
    // surface as one cluster and mixed-shape siblings (e.g. HN's athing +
    // subtext rows) split apart.
    const groups = new Map<string, Element[]>();
    for (const child of Array.from(container.childNodes)) {
      if (!isElement(child)) {
        continue;
      }
      const key = shapeKey(child);
      const bucket = groups.get(key);
      if (bucket) {
        bucket.push(child);
      } else {
        groups.set(key, [child]);
      }
    }
    for (const children of groups.values()) {
      if (children.length < MIN_ITEMS) {
        continue;
      }
      // EVERY member must carry a real anchor — one linkless <li> breaks
      // homogeneity and rejects the group, which is what keeps a <ul> of
      // plain-text list items (e.g. recipe ingredients) from triggering.
      if (!children.every(child => navigationAnchors(child).length > 0)) {
        continue;
      }
      const items: ListItem[] = [];
      for (const child of children) {
        const item = extractItem(child, baseUrl);
        if (item) {
          items.push(item);
        }
      }
      if (items.length < MIN_ITEMS) {
        continue;
      }
      candidates.push({
        containerSelector: describeSelector(container),
        distinctPathnames: distinctPathnames(items),
        itemTag: children[0].tagName,
        items,
        totalScore: items.reduce((sum, item) => sum + item.score, 0),
      });
    }
  }
  return candidates;
}

function confidenceFor(items: readonly ListItem[]): ListConfidence {
  if (items.length < MIN_ITEMS) {
    return 'low';
  }
  if (items.length >= HIGH_CONF_ITEMS) {
    const avg = items.reduce((sum, item) => sum + item.score, 0) / items.length;
    return avg >= HIGH_CONF_AVG_SCORE ? 'high' : 'medium';
  }
  return 'medium';
}

function notDetected(note: string): ListDetectionResult {
  return {
    confidence: 'low',
    containerSelector: '',
    detected: false,
    itemCount: 0,
    itemTag: '',
    items: [],
    note,
  };
}

// Detect a list/feed/index structure on a non-article page. Strips chrome
// (nav/header/footer/aside + ARIA roles) first so an article's menu doesn't
// look like a 4-item feed, then walks for containers whose direct children
// form a homogeneous sibling group of ≥3 elements each carrying a real anchor.
// Winner selection prefers the candidate whose items navigate to the most
// distinct destinations — the signature of a real feed — over a same-path
// metadata cluster (HN's subtext rows all link to /item?id=…). Item count is
// the second key (a 30-item feed beats a 4-item related-links block) and total
// per-item score breaks remaining ties.
export function detectList(
  document: Document,
  url?: string,
): ListDetectionResult {
  for (const el of document.querySelectorAll(CHROME_SELECTOR)) {
    el.remove();
  }
  for (const el of document.querySelectorAll('script, style, template')) {
    el.remove();
  }

  const candidates = collectCandidates(document, url);
  if (candidates.length === 0) {
    return notDetected(
      'not a list: no repeated item structure with links (≥3 same-shape siblings each carrying an anchor, outside nav/header/footer/aside)',
    );
  }

  let winner = candidates[0];
  for (let i = 1; i < candidates.length; i++) {
    const candidate = candidates[i];
    if (
      candidate.distinctPathnames > winner.distinctPathnames ||
      (candidate.distinctPathnames === winner.distinctPathnames &&
        candidate.items.length > winner.items.length) ||
      (candidate.distinctPathnames === winner.distinctPathnames &&
        candidate.items.length === winner.items.length &&
        candidate.totalScore > winner.totalScore)
    ) {
      winner = candidate;
    }
  }

  if (winner.items.length < MIN_ITEMS) {
    return notDetected(
      'not a list: best candidate had fewer than 3 extracted items',
    );
  }

  const items = winner.items;
  return {
    confidence: confidenceFor(items),
    containerSelector: winner.containerSelector,
    detected: true,
    itemCount: items.length,
    itemTag: winner.itemTag,
    items,
    note: `detected ${items.length} ${winner.itemTag} items in ${winner.containerSelector}`,
  };
}
