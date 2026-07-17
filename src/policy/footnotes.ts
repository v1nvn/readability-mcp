import { buildDocument } from '../pipeline/dom.js';

export interface FootnoteResult {
  readonly footnoteDefs: readonly string[];
  readonly html: string;
}

// jsdom-parsing every turndown call would dominate hot paths; this pre-check
// gates on a string scan so footnote-less articles pay nothing.
const FOOTNOTE_SIGNAL_RE =
  /cite_note|cite_ref|class="footnotes"|class="references"|data-footnote|role="doc-endnote|<sup\b[^>]*>\s*<a\s[^>]*href="#/i;

// First match wins per group; an `<ol class="footnotes">` is the common case.
const DEFINITION_CONTAINER_SELECTORS = [
  'ol.footnotes',
  'ol[class*="footnotes"]',
  'ol.references',
  'ol[class*="references"]',
  'section[class*="footnote"]',
  'div[class*="footnote"]',
  '[role="doc-endnotes"]',
  '[role="doc-bibliography"]',
] as const;

const STANDALONE_DEF_ID_RE = /^(?:fn|cite_note|footnote|note)[:_-]/i;

interface RefHit {
  readonly defId: string;
  readonly n: number;
  readonly sup: Element;
}

// Some sites prepend a back-to-text caret or "Jump to" label to each definition.
// Stripping only a leading occurrence keeps accidental mid-text carets intact.
const BACKREF_LEADING_RE = /^(?:↑\s?|↩\s?|\^\s|Jump to\s*)/;

function cleanDefText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().replace(BACKREF_LEADING_RE, '');
}

function collectDefinitions(document: Document): {
  readonly containers: ReadonlySet<Element>;
  readonly defs: ReadonlyMap<string, string>;
  readonly standaloneIds: ReadonlySet<string>;
} {
  const containers = new Set<Element>();
  const defs = new Map<string, string>();
  const standaloneIds = new Set<string>();

  for (const selector of DEFINITION_CONTAINER_SELECTORS) {
    let matched: NodeListOf<Element>;
    try {
      matched = document.querySelectorAll(selector);
    } catch {
      continue;
    }
    for (const container of Array.from(matched)) {
      if (!containers.has(container)) {
        containers.add(container);
      }
      for (const item of Array.from(
        container.querySelectorAll('li, [role="doc-endnote"]'),
      )) {
        const id = item.id;
        if (!id || defs.has(id)) {
          continue;
        }
        const text = cleanDefText(item.textContent);
        if (text) {
          defs.set(id, text);
        }
      }
    }
  }

  // Some sites scatter `<li id="fn1">` outside any container; collect those too.
  for (const li of Array.from(document.querySelectorAll('li[id]'))) {
    const id = li.id;
    if (!id || defs.has(id) || !STANDALONE_DEF_ID_RE.test(id)) {
      continue;
    }
    const text = cleanDefText(li.textContent);
    if (text) {
      defs.set(id, text);
      standaloneIds.add(id);
    }
  }

  return { containers, defs, standaloneIds };
}

export function processFootnotes(html: string): FootnoteResult | null {
  if (!html || !FOOTNOTE_SIGNAL_RE.test(html)) {
    return null;
  }

  let document: Document;
  try {
    document = buildDocument(html).document;
  } catch {
    return null;
  }

  const { containers, defs, standaloneIds } = collectDefinitions(document);
  if (defs.size === 0) {
    return null;
  }

  const refHits: RefHit[] = [];
  const defIdToNumber = new Map<string, number>();
  for (const sup of Array.from(document.querySelectorAll('sup'))) {
    if (!sup.isConnected) {
      continue;
    }
    try {
      const anchor = sup.querySelector('a[href^="#"]');
      if (!anchor) {
        continue;
      }
      const frag = (anchor.getAttribute('href') ?? '').slice(1);
      if (!frag || !defs.has(frag)) {
        continue;
      }
      let n = defIdToNumber.get(frag);
      if (n === undefined) {
        n = defIdToNumber.size + 1;
        defIdToNumber.set(frag, n);
      }
      refHits.push({ defId: frag, n, sup });
    } catch {
      // Defensive: malformed <sup> must not abort the whole pass.
    }
  }

  if (refHits.length === 0) {
    return null;
  }

  for (const { n, sup } of refHits) {
    try {
      sup.replaceWith(document.createTextNode(`[^${n}]`));
    } catch {
      // skip
    }
  }

  // Drop the rendered references list so it doesn't duplicate the appended
  // `[^N]:` block. Removing containers also takes care of the standalone <li>
  // elements that lived inside them; only out-of-container standalones need
  // individual removal here.
  for (const container of containers) {
    if (container.isConnected) {
      container.remove();
    }
  }
  for (const id of standaloneIds) {
    const el = document.getElementById(id);
    if (el?.isConnected) {
      el.remove();
    }
  }

  const numberToDefId = new Map<number, string>();
  for (const [id, n] of defIdToNumber) {
    numberToDefId.set(n, id);
  }
  const footnoteDefs: string[] = [];
  for (let n = 1; n <= numberToDefId.size; n++) {
    const id = numberToDefId.get(n);
    if (id === undefined) {
      break;
    }
    const text = defs.get(id);
    if (text !== undefined) {
      footnoteDefs.push(text);
    }
  }

  // buildDocument wraps both full documents and bare fragments in a <body>;
  // serializing its innerHTML returns the equivalent of the input region.
  return {
    footnoteDefs,
    html: document.body.innerHTML,
  };
}
