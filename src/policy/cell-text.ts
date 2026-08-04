// Resolve a table/grid cell element to the string that represents it in the
// matrix. Shared by policy/tables.ts (the <table> serializer) and
// policy/grid-detector.ts (the div-grid detector) so both paths project a cell
// the same way: whitespace-normalized visible text, with two fallbacks.
//
// 1. Tooltip/badge/aria wrappers carry chrome, not data — they are stripped
//    from a clone so a label cell reads "Market Capitalization" rather than
//    concatenating every descendant. But stripping must never empty a cell: a
//    badge/aria element that holds a cell's only text is data, not chrome, so
//    when stripping would blank the cell the full text is kept.
// 2. A cell whose only content is an icon link has no visible text at all; its
//    value lives in the anchor's href, which is surfaced as a last resort.
const CELL_CHROME_SELECTOR =
  '[aria-label], [data-tooltip], [data-toggle="tooltip"], .tooltip, .badge';

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

// All non-empty hrefs reachable from the cell, including the cell itself when it
// is an anchor (a div-grid "cell" can be an <a>). Descendant-only search would
// miss a link-cell whose element IS the anchor.
function nonEmptyHrefs(cell: Element): string[] {
  const anchors: Element[] =
    cell.tagName === 'A'
      ? [cell, ...Array.from(cell.querySelectorAll('a[href]'))]
      : Array.from(cell.querySelectorAll('a[href]'));
  const hrefs: string[] = [];
  for (const a of anchors) {
    const href = (a.getAttribute('href') ?? '').trim();
    if (href !== '') {
      hrefs.push(href);
    }
  }
  return hrefs;
}

export function resolveCellText(cell: Element): string {
  const full = normalize(cell.textContent);
  let resolved = full;
  if (full !== '') {
    const clone = cell.cloneNode(true) as Element;
    clone.querySelectorAll(CELL_CHROME_SELECTOR).forEach(el => {
      el.remove();
    });
    const stripped = normalize(clone.textContent);
    resolved = stripped !== '' ? stripped : full;
  }
  if (resolved === '') {
    const hrefs = nonEmptyHrefs(cell);
    if (hrefs.length > 0) {
      return hrefs.join(' ');
    }
  }
  return resolved;
}
