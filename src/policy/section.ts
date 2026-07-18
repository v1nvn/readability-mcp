import { normalizeHeadingText } from './outline.js';

interface HeadingMatch {
  readonly heading: Element;
  readonly level: number;
}

// Match the first heading by normalized text. Exact equality wins; otherwise
// fall back to the first substring match so a short query ("auth") still
// lands on a longer heading ("Authentication") without forcing an exact match.
function findHeading(
  document: Document,
  query: string,
): HeadingMatch | undefined {
  const needle = normalizeHeadingText(query).toLowerCase();
  if (!needle) {
    return undefined;
  }
  const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
  let substring: HeadingMatch | undefined;
  for (const heading of headings) {
    const text = normalizeHeadingText(heading.textContent).toLowerCase();
    if (!text) {
      continue;
    }
    const level = Number.parseInt(heading.tagName.slice(1), 10);
    if (text === needle) {
      return { heading, level };
    }
    if (!substring && text.includes(needle)) {
      substring = { heading, level };
    }
  }
  return substring;
}

// Elements whose direct children form the section flow. The matched heading's
// nearest such ancestor is the level at which the section's content lives as
// siblings: on docs sites (GitHub markdown, etc.) the heading is wrapped in
// <div class="markdown-heading">, so the body <p> is a sibling of the wrapper
// div, not of the <h2>. Walking the <h2>'s own siblings would capture only the
// permalink anchor and miss the body.
const FLOW_CONTAINERS = new Set([
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'BODY',
  'DD',
  'DETAILS',
  'DT',
  'FOOTER',
  'HEADER',
  'LI',
  'MAIN',
  'NAV',
  'SECTION',
  'TD',
]);

function findFlowContainer(heading: Element): Element {
  let ancestor: Element | null = heading.parentElement;
  while (ancestor) {
    if (FLOW_CONTAINERS.has(ancestor.tagName)) {
      return ancestor;
    }
    ancestor = ancestor.parentElement;
  }
  // BODY is in FLOW_CONTAINERS, so the loop reaches it for any attached
  // heading; this fallback only covers a detached heading.
  return heading.ownerDocument.body;
}

function isElement(node: Node): node is Element {
  return node.nodeType === 1;
}

// Level of the first heading at or inside `el`, or undefined when `el` is
// neither a heading nor a wrapper around one. Used to test whether a following
// sibling terminates the section.
function firstHeadingLevel(el: Element): number | undefined {
  const direct = /^H([1-6])$/.exec(el.tagName);
  if (direct) {
    return Number.parseInt(direct[1], 10);
  }
  const inner = el.querySelector('h1, h2, h3, h4, h5, h6');
  if (inner) {
    return Number.parseInt(inner.tagName.slice(1), 10);
  }
  return undefined;
}

// Wraps the matched heading and its subtree in a `<section data-rdrm-section-scope>`
// so the existing selectors.include path can isolate it. Returns false (and
// leaves the document untouched) when no heading matches.
export function scopeToHeading(
  document: Document,
  headingText: string,
): boolean {
  const match = findHeading(document, headingText);
  if (!match) {
    return false;
  }
  const { heading, level } = match;
  const container = findFlowContainer(heading);
  let startChild: Element = heading;
  while (startChild.parentElement && startChild.parentElement !== container) {
    startChild = startChild.parentElement;
  }
  const wrap = document.createElement('section');
  wrap.setAttribute('data-rdrm-section-scope', '');
  container.insertBefore(wrap, startChild);
  let node: Node | null = startChild;
  while (node) {
    const next: Node | null = node.nextSibling;
    wrap.appendChild(node);
    // A section ends at the next same-or-higher-level heading (level <= L):
    // deeper headings (h3 under an h2) belong to this section, peers and
    // shallower headings start the next one. The terminating sibling may be a
    // wrapper around the heading (e.g. <div class="markdown-heading">), so the
    // check looks for a heading at OR inside the sibling.
    if (next !== null && isElement(next)) {
      const nextLevel = firstHeadingLevel(next);
      if (nextLevel !== undefined && nextLevel <= level) {
        break;
      }
    }
    node = next;
  }
  return true;
}
