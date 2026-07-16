export interface TruncateResult {
  readonly text: string;
  readonly truncated: boolean;
}

// A fence delimiter opens or closes a CommonMark fenced code block: 0-3 spaces
// of indentation followed by ``` or ~~~ (3+).
const FENCE_DELIMITER = /^[ ]{0,3}(`{3,}|~{3,})/;

function isFenceDelimiter(line: string): boolean {
  return FENCE_DELIMITER.test(line);
}

interface SplitBlock {
  readonly text: string;
}

function splitBlocks(markdown: string): SplitBlock[] {
  const lines = markdown.split('\n');
  const blocks: SplitBlock[] = [];
  let current: string[] = [];
  let insideFence = false;

  function flush(): void {
    if (current.length > 0) {
      blocks.push({ text: current.join('\n') });
      current = [];
    }
  }

  for (const line of lines) {
    if (isFenceDelimiter(line)) {
      insideFence = !insideFence;
      current.push(line);
      continue;
    }
    if (line.trim() === '' && !insideFence) {
      flush();
      continue;
    }
    current.push(line);
  }
  flush();
  return blocks;
}

function endsInsideOpenFence(text: string): boolean {
  let fences = 0;
  for (const line of text.split('\n')) {
    if (isFenceDelimiter(line)) {
      fences += 1;
    }
  }
  return fences % 2 !== 0;
}

function rollBackOpenFence(text: string): string {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (isFenceDelimiter(lines[i])) {
      return lines.slice(0, i).join('\n');
    }
  }
  return text;
}

const TRUNCATION_MARKER = '\n\n…[truncated]';

// Cuts at a block boundary; fenced blocks are atomic so the cut never lands
// inside one. If the accumulated text still ends inside an open fence, roll
// back to before it opened.
export function truncateMarkdown(
  markdown: string,
  maxChars: number,
): TruncateResult {
  if (markdown.length <= maxChars) {
    return { text: markdown, truncated: false };
  }

  const blocks = splitBlocks(markdown);
  let accumulated = '';
  let truncated = false;
  for (const block of blocks) {
    const sep = accumulated.length === 0 ? '' : '\n\n';
    const candidate = accumulated + sep + block.text;
    if (candidate.length <= maxChars) {
      accumulated = candidate;
    } else {
      truncated = true;
      break;
    }
  }

  if (!truncated) {
    return { text: markdown, truncated: false };
  }

  let text = accumulated;
  if (endsInsideOpenFence(text)) {
    text = rollBackOpenFence(text);
  }
  text = text.replace(/\s+$/, '');
  return { text: text + TRUNCATION_MARKER, truncated: true };
}
