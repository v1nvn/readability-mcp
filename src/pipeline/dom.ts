import { JSDOM } from 'jsdom';

export interface BuiltDocument {
  readonly document: Document;
  readonly window: Window;
}

export function buildDocument(html: string, url?: string): BuiltDocument {
  const dom = new JSDOM(html, { url });
  return { document: dom.window.document, window: dom.window };
}
