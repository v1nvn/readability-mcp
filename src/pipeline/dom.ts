// jsdom build helper (DESIGN §6.3). The `url` option is load-bearing: it sets
// the document's origin so Readability can resolve relative <img src>/<a href>
// against the page's real URL rather than `about:blank`. jsdom does not execute
// page scripts by default, which is correct here — the input is already the
// post-JS DOM captured from chrome-devtools.

import { JSDOM } from 'jsdom';

export interface BuiltDocument {
  readonly document: Document;
  readonly window: Window;
}

export function buildDocument(html: string, url?: string): BuiltDocument {
  const dom = new JSDOM(html, { url });
  return { document: dom.window.document, window: dom.window };
}
