import DOMPurify, {
  type DOMPurify as DOMPurifyInstance,
  type WindowLike as DOMPurifyWindow,
} from 'dompurify';

export interface SanitizeResult {
  readonly html: string;
  readonly iframesRemoved: number;
  readonly scriptsRemoved: number;
}

function countRemoved(
  removed: DOMPurifyInstance['removed'],
  tagName: string,
): number {
  let count = 0;
  for (const entry of removed) {
    // RemovedAttribute entries have no `element`; count element removals only.
    if (
      'element' in entry &&
      entry.element.nodeName.toUpperCase() === tagName
    ) {
      count += 1;
    }
  }
  return count;
}

export function sanitizeHtml(dirty: string, window: Window): SanitizeResult {
  // DOMPurify's WindowLike is structurally compatible at runtime but not under TS.
  const purify = DOMPurify(window as unknown as DOMPurifyWindow);
  const html = purify.sanitize(dirty);
  return {
    html,
    iframesRemoved: countRemoved(purify.removed, 'IFRAME'),
    scriptsRemoved: countRemoved(purify.removed, 'SCRIPT'),
  };
}
