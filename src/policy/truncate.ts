// Block-boundary truncation (DESIGN §5.1/§9). When `maxChars` is set the payload
// is cut at a block boundary — NEVER inside a fenced code block.
//
// Algorithm: split the payload into fence-aware blocks (a block is a run of
// consecutive non-blank lines, where blank lines INSIDE an open code fence stay
// with the block). Accumulate blocks while they fit; when the next block would
// exceed `maxChars`, stop. Because fenced blocks are atomic, the cut can never
// land inside one — but as a belt-and-suspenders guard, if the accumulated text
// somehow ends with an odd number of fence delimiters (indented fence the
// detector missed, malformed input), roll the cut back to before that fence
// opened. Append a clear truncation marker.

export interface TruncateResult {
  readonly text: string;
  readonly truncated: boolean;
}

// A fence delimiter opens or closes a CommonMark fenced code block: 0-3 spaces
// of indentation followed by ``` or ~~~ (3+). Turndown always emits backticks.
const FENCE_DELIMITER = /^[ ]{0,3}(`{3,}|~{3,})/;

function isFenceDelimiter(line: string): boolean {
  return FENCE_DELIMITER.test(line);
}

interface SplitBlock {
  readonly text: string;
}

// Split into fence-aware blocks. Blank lines outside a fence separate blocks;
// blank lines inside a fence are kept (they belong to the code block).
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

// Count fence delimiters in the accumulated text; odd ⇒ an open fence.
function endsInsideOpenFence(text: string): boolean {
  let fences = 0;
  for (const line of text.split('\n')) {
    if (isFenceDelimiter(line)) {
      fences += 1;
    }
  }
  return fences % 2 !== 0;
}

// Remove the trailing partial fence block: cut everything from the last
// fence-delimiter line onward so no ``` is left dangling.
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
    // Every block fit (can happen when maxChars sits between block boundaries
    // and total length); nothing to do.
    return { text: markdown, truncated: false };
  }

  let text = accumulated;
  if (endsInsideOpenFence(text)) {
    text = rollBackOpenFence(text);
  }
  // Trim trailing whitespace so the marker sits on its own paragraph, then append.
  text = text.replace(/\s+$/, '');
  return { text: text + TRUNCATION_MARKER, truncated: true };
}
