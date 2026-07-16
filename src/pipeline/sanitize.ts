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

export function sanitizeHtml(
  dirty: string,
  window: Window,
  options?: SanitizeOptions,
): SanitizeResult {
  // DOMPurify's WindowLike is structurally compatible at runtime but not under TS.
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
