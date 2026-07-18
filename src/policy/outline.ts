export interface OutlineEntry {
  readonly anchor: string;
  readonly level: number;
  readonly text: string;
}

// Collapse whitespace, trim, then strip leading/trailing `#` (GitHub permalinks
// append `<a>#</a>`, so heading textContent ends with `#`).
export function normalizeHeadingText(raw: string): string {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  return collapsed.replace(/^#+|#+$/g, '').trim();
}

// GFM anchor algorithm (comrak `anchorize`): keep Unicode letters, marks,
// numbers, and connector punctuation; map spaces to hyphens. No hyphen collapse
// or trim, so anchors match GitHub and non-Latin scripts survive. An all-symbol
// heading yields an empty slug; fall back to `section` so anchors stay non-empty.
function slugify(text: string): string {
  const cleaned = text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '');
  return cleaned.replace(/ /g, '-') || 'section';
}

// `href="#"` (empty fragment) does not win — fall through to slugify.
function linkAnchor(heading: Element): string | undefined {
  for (const link of heading.querySelectorAll('a[href^="#"]')) {
    const href = link.getAttribute('href');
    if (!href) {
      continue;
    }
    const fragment = href.slice(1);
    if (fragment) {
      return fragment;
    }
  }
  return undefined;
}

function resolveCandidate(
  heading: Element,
  text: string,
): { readonly anchor: string; readonly explicit: boolean } {
  const id = heading.getAttribute('id');
  if (id) {
    return { anchor: id, explicit: true };
  }
  const link = linkAnchor(heading);
  if (link) {
    return { anchor: link, explicit: true };
  }
  return { anchor: slugify(text), explicit: false };
}

// Explicit anchors are kept verbatim; generated slugs are collision-suffixed
// (`-1`, `-2`, …), first occurrence bare.
function dedupe(
  candidate: string,
  explicit: boolean,
  used: Set<string>,
): string {
  if (explicit || !used.has(candidate)) {
    return candidate;
  }
  let suffix = 1;
  while (used.has(`${candidate}-${suffix}`)) {
    suffix++;
  }
  return `${candidate}-${suffix}`;
}

export function resolveOutline(document: Document): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  const used = new Set<string>();
  const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
  headings.forEach(heading => {
    const rawText = heading.textContent;
    if (!rawText.trim()) {
      return;
    }
    const text = normalizeHeadingText(rawText);
    const level = Number.parseInt(heading.tagName.slice(1), 10);
    const { anchor: candidate, explicit } = resolveCandidate(heading, text);
    const anchor = dedupe(candidate, explicit, used);
    used.add(anchor);
    entries.push({ anchor, level, text });
  });
  return entries;
}
