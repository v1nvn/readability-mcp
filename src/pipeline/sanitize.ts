// DOMPurify sanitization (DESIGN §6.3, §11.3). DOMPurify 3.x's default export
// is a *factory* that must be bound to a real window — specifically the SAME
// jsdom window the article document came from (jsdom/dompurify coupling is the
// flagged risk in DESIGN §11.3). After sanitizing we read `purify.removed` to
// count the <script>/<iframe> nodes DOMPurify dropped, for diagnostics.

import DOMPurify, {
  type Config as DOMPurifyConfig,
  type DOMPurify as DOMPurifyInstance,
  type WindowLike as DOMPurifyWindow,
} from 'dompurify';

export interface SanitizeResult {
  readonly html: string;
  readonly iframesRemoved: number;
  readonly scriptsRemoved: number;
}

export interface SanitizeOptions {
  readonly forbidTags?: readonly string[];
}

function countRemoved(
  removed: DOMPurifyInstance['removed'],
  tagName: string,
): number {
  let count = 0;
  for (const entry of removed) {
    // RemovedAttribute entries have no `element`; only count element removals.
    if (
      'element' in entry &&
      entry.element.nodeName.toUpperCase() === tagName
    ) {
      count += 1;
    }
  }
  return count;
}

export function sanitizeHtml(
  dirty: string,
  window: Window,
  options?: SanitizeOptions,
): SanitizeResult {
  // DOMPurify's WindowLike is a Pick<typeof globalThis, …>; the DOM-lib `Window`
  // type we pass in is structurally compatible at runtime (verified) but not
  // assignable under TS, so cast across the boundary.
  const purify = DOMPurify(window as unknown as DOMPurifyWindow);
  const config: DOMPurifyConfig = {};
  if (options?.forbidTags && options.forbidTags.length > 0) {
    config.FORBID_TAGS = [...options.forbidTags];
  }
  const html = purify.sanitize(dirty, config);
  return {
    html,
    iframesRemoved: countRemoved(purify.removed, 'IFRAME'),
    scriptsRemoved: countRemoved(purify.removed, 'SCRIPT'),
  };
}
