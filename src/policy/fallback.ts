// Fallback selector cascade (DESIGN §5.1). When Readability's parse() returns
// no article content, walk a selector cascade and extract the first hit that
// yields non-empty Markdown:
//   article → main → [role=main] → largest text-dense block → body
// The chosen root is sanitized and Turndowned on the SAME path as a main
// article, so the caller always gets *something* usable and can tell it is
// best-effort from diagnostics.fallbackUsed / extractedNode.
//
// Refinement of §5.1 wording: we trust Readability when parse() returns content
// even if isProbablyReaderable was false — the cascade runs ONLY on parse
// failure. `readerable` stays an honest diagnostic either way.

import type { SanitizationDiagnostics } from '../pipeline/context.js';
import type { ImageMode } from '../pipeline/turndown.js';

import { sanitizeHtml } from '../pipeline/sanitize.js';
import { toMarkdown } from '../pipeline/turndown.js';

export interface FallbackOptions {
  readonly codeBlockStyle?: 'fenced' | 'indented';
  readonly gfm?: boolean;
  readonly headingStyle?: 'atx' | 'setext';
  readonly images?: ImageMode;
  readonly sanitize: boolean;
  readonly url?: string;
  readonly window: Window;
}

export interface FallbackResult {
  readonly markdown: string;
  readonly rootSelector: string;
  readonly sanitization: SanitizationDiagnostics;
  readonly sanitizedHtml: string;
  readonly textContent: string;
}

// Below this length a block is treated as not text-dense (nav/boilerplate-ish),
// matching the spirit of Readability's own content-length floor.
const MIN_DENSE_BLOCK_CHARS = 200;

function convert(
  element: Element,
  options: Readonly<FallbackOptions>,
):
  | undefined
  | {
      markdown: string;
      sanitization: SanitizationDiagnostics;
      sanitizedHtml: string;
      textContent: string;
    } {
  const rawHtml = element.outerHTML;
  let sanitizedHtml = rawHtml;
  let sanitization: SanitizationDiagnostics = { iframes: 0, scripts: 0 };
  if (options.sanitize) {
    const res = sanitizeHtml(rawHtml, options.window);
    sanitizedHtml = res.html;
    sanitization = { iframes: res.iframesRemoved, scripts: res.scriptsRemoved };
  }
  const markdown = toMarkdown(sanitizedHtml, {
    codeBlockStyle: options.codeBlockStyle,
    gfm: options.gfm,
    headingStyle: options.headingStyle,
    images: options.images,
    url: options.url,
  });
  const textContent = element.textContent;
  if (markdown.trim().length === 0) {
    return undefined;
  }
  return { markdown, sanitization, sanitizedHtml, textContent };
}

function largestTextDenseBlock(document: Document): Element | undefined {
  let best: Element | undefined;
  let bestLen = 0;
  const candidates = document.querySelectorAll('div, section');
  candidates.forEach(el => {
    const len = el.textContent.trim().length;
    if (len > bestLen && len >= MIN_DENSE_BLOCK_CHARS) {
      best = el;
      bestLen = len;
    }
  });
  return best;
}

// Walk the cascade in priority order, returning the first root that produces
// non-empty Markdown. `largest-block` has no real selector; we name it
// descriptively so diagnostics.extractedNode still reads cleanly.
export function extractViaFallback(
  document: Document,
  options: Readonly<FallbackOptions>,
): FallbackResult | null {
  const orderedSelectors: readonly string[] = [
    'article',
    'main',
    '[role=main]',
  ];
  for (const selector of orderedSelectors) {
    const root = document.querySelector(selector);
    if (root) {
      const converted = convert(root, options);
      if (converted) {
        return { ...converted, rootSelector: selector };
      }
    }
  }

  const dense = largestTextDenseBlock(document);
  if (dense) {
    const converted = convert(dense, options);
    if (converted) {
      return { ...converted, rootSelector: 'largest-block' };
    }
  }

  // Last resort: the whole body.
  const converted = convert(document.body, options);
  if (converted) {
    return { ...converted, rootSelector: 'body' };
  }

  return null;
}
