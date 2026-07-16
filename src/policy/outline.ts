// Document outline resolver. A flat walk of h1-h6 in document order, producing
// stable, unique anchor ids. Anchor precedence (first non-empty wins): the
// heading's own id, then the fragment of a descendant permalink anchor, then a
// slug derived from the text. Author-supplied ids/fragments are kept verbatim
// (never suffixed); only generated slugs are de-duplicated with a -N suffix.

export interface OutlineEntry {
  readonly anchor: string;
  readonly level: number;
  readonly text: string;
}

// Collapse internal whitespace runs to a single space, trim, then strip any
// leading/trailing `#` (GitHub permalinks append `<a ...>#</a>`, so the heading
// textContent ends with `#`). Re-trim in case the strip exposes new edges.
function normalizeText(raw: string): string {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  return collapsed.replace(/^#+|#+$/g, '').trim();
}

// lowercase -> whitespace runs to single `-` -> drop non-[a-z0-9-] -> collapse
// repeated `-` -> trim edge `-`. An all-symbol heading yields an empty slug,
// which falls back to the literal `section` so anchors are always non-empty.
function slugify(text: string): string {
  const slashed = text.toLowerCase().replace(/\s+/g, '-');
  const cleaned = slashed.replace(/[^a-z0-9-]/g, '');
  const collapsed = cleaned.replace(/-+/g, '-').replace(/^-|-$/g, '');
  return collapsed || 'section';
}

// First descendant <a> whose href starts with `#` and yields a non-empty
// fragment. `href="#"` (empty fragment) does not win — the heading falls through
// to slugify instead of adopting a blank anchor.
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

// Resolve the candidate anchor and whether it is author-supplied (verbatim) or
// generated (subject to de-duplication).
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

// Explicit anchors are returned verbatim (author ids are not rewritten).
// Generated slugs collide-suffixed GitHub-style: first occurrence stays bare,
// the next collision takes `-1`, then `-2`, and so on.
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
    const text = normalizeText(rawText);
    const level = Number.parseInt(heading.tagName.slice(1), 10);
    const { anchor: candidate, explicit } = resolveCandidate(heading, text);
    const anchor = dedupe(candidate, explicit, used);
    used.add(anchor);
    entries.push({ anchor, level, text });
  });
  return entries;
}
