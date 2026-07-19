import { JSDOM } from 'jsdom';

export interface BuiltDocument {
  readonly document: Document;
  readonly window: Window;
}

// Built only from caller-supplied `html`; `url` is origin context for
// absolutization, never fetched. Parse and the downstream Readability walk run
// synchronously on the event loop — no worker isolation or wall-clock timeout
// guards them. A worker pool was deferred rather than rejected: the synchronous
// parse can't be interrupted in-process, and `worker_threads` can't load the dev
// hot-reload loop's in-memory Vite modules. `maxNodes` is the only input-size
// bound until a holistic worker strategy lands; a standalone `timeout` option
// would mislead (it can't interrupt the parse), so it ships with the worker.
export function buildDocument(html: string, url?: string): BuiltDocument {
  const dom = new JSDOM(html, { url });
  return { document: dom.window.document, window: dom.window };
}
