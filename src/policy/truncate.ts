import { parseBlocks } from './markdown.js';

export interface TruncateResult {
  readonly text: string;
  readonly truncated: boolean;
}

const TRUNCATION_MARKER = '\n\n…[truncated]';

// Cuts at a top-level block boundary. A fenced code block is a single mdast
// node, so a boundary cut never lands inside one — no open-fence rollback is
// needed. The kept span is sliced from the original string so the payload is a
// byte-for-byte prefix of the Turndown output.
export function truncateMarkdown(
  markdown: string,
  maxChars: number,
): TruncateResult {
  if (markdown.length <= maxChars) {
    return { text: markdown, truncated: false };
  }

  const blocks = parseBlocks(markdown);
  let start = -1;
  let end = -1;
  let truncated = false;
  for (const block of blocks) {
    const from = start === -1 ? block.start : start;
    if (block.end - from > maxChars) {
      truncated = true;
      break;
    }
    if (start === -1) {
      start = block.start;
    }
    end = block.end;
  }

  if (!truncated) {
    return { text: markdown, truncated: false };
  }

  const kept = start === -1 ? '' : markdown.slice(start, end);
  return {
    text: kept.replace(/\s+$/, '') + TRUNCATION_MARKER,
    truncated: true,
  };
}
