// Char-strategy chunking: greedily group markdown blocks into token-bounded
// chunks for RAG/embedding. The `chars/4` estimator mirrors policy/metadata.ts
// so a chunk's `tokenCount` is directly comparable to `metadata.tokenEstimate`.

export interface Chunk {
  readonly headingContext: string;
  readonly index: number;
  readonly text: string;
  readonly tokenCount: number;
}

// Extended to 'char' | 'semantic' by CTX-3; only 'char' ships in this item.
export type ChunkStrategy = 'char';

export interface ChunkOptions {
  readonly maxTokens: number;
  readonly overlap: number;
  readonly strategy: ChunkStrategy;
}

interface Block {
  readonly headingContext: string;
  readonly text: string;
}

interface Unit {
  readonly headingContext: string;
  readonly text: string;
}

// Character offsets of a contributing unit within the in-progress chunk text;
// used to recover the heading context at the start of an overlap tail.
interface Span {
  readonly end: number;
  readonly headingContext: string;
  readonly start: number;
}

const HEADING_FIRST_LINE = /^#{1,6}\s/;

function headingText(blockText: string): string {
  const firstLine = blockText.split('\n', 1)[0] ?? '';
  return firstLine.replace(/^#{1,6}\s+/, '').trim();
}

function splitBlocks(markdown: string): Block[] {
  const parts = markdown.split(/\n{2,}/);
  const blocks: Block[] = [];
  let heading = '';
  for (const part of parts) {
    const text = part.trim();
    if (!text) {
      continue;
    }
    if (HEADING_FIRST_LINE.test(text)) {
      heading = headingText(text);
    }
    blocks.push({ headingContext: heading, text });
  }
  return blocks;
}

// Hard-cap a block to <= maxChars: split by lines first, then hard-split any
// oversized line. Char strategy may break a code block — the semantic strategy
// (CTX-3) avoids that, but it is out of scope here.
function splitOversizedBlock(block: Block, maxChars: number): Unit[] {
  const units: Unit[] = [];
  const lines = block.text.split('\n');
  let buffer = '';
  function flush(): void {
    if (buffer) {
      units.push({ headingContext: block.headingContext, text: buffer });
      buffer = '';
    }
  }
  for (const line of lines) {
    if (line.length > maxChars) {
      flush();
      for (let i = 0; i < line.length; i += maxChars) {
        units.push({
          headingContext: block.headingContext,
          text: line.slice(i, i + maxChars),
        });
      }
      continue;
    }
    const candidate = buffer ? `${buffer}\n${line}` : line;
    if (candidate.length > maxChars) {
      flush();
      buffer = line;
    } else {
      buffer = candidate;
    }
  }
  flush();
  return units;
}

function toUnits(blocks: readonly Block[], maxChars: number): Unit[] {
  const units: Unit[] = [];
  for (const block of blocks) {
    if (block.text.length <= maxChars) {
      units.push(block);
    } else {
      units.push(...splitOversizedBlock(block, maxChars));
    }
  }
  return units;
}

export function chunkMarkdown(
  markdown: string,
  options: Readonly<ChunkOptions>,
): Chunk[] {
  if (!markdown) {
    return [];
  }
  const maxTokens = Math.max(1, Math.floor(options.maxTokens));
  const maxChars = maxTokens * 4;
  const overlapTokens = Math.max(0, Math.floor(options.overlap));
  // Overlap must be strictly less than maxChars — otherwise a chunk's tail
  // could consume the entire budget and we'd loop forever re-emitting it.
  const overlapChars = Math.min(overlapTokens * 4, maxChars - 1);

  const blocks = splitBlocks(markdown);
  if (blocks.length === 0) {
    return [];
  }
  const units = toUnits(blocks, maxChars);
  if (units.length === 0) {
    return [];
  }

  const chunks: Chunk[] = [];
  let i = 0;
  let overlapText = '';
  let overlapHeading = '';

  while (i < units.length) {
    const spans: Span[] = [];
    let chunkText = '';

    if (overlapText) {
      chunkText = overlapText;
      spans.push({
        end: overlapText.length,
        headingContext: overlapHeading,
        start: 0,
      });
    }

    // Force at least one new unit per chunk so the loop terminates. If carrying
    // the overlap would push the first new unit past maxChars, drop the overlap
    // for this chunk (the unit was pre-split to <= maxChars so it always fits alone).
    const firstUnit = units[i];
    const sepLen = chunkText ? 2 : 0;
    if (
      chunkText &&
      chunkText.length + sepLen + firstUnit.text.length > maxChars
    ) {
      chunkText = '';
      spans.length = 0;
    }

    {
      const sep = chunkText ? '\n\n' : '';
      const start = chunkText.length + sep.length;
      chunkText = chunkText + sep + firstUnit.text;
      spans.push({
        end: chunkText.length,
        headingContext: firstUnit.headingContext,
        start,
      });
      i += 1;
    }

    while (i < units.length) {
      const unit = units[i];
      const candidate = `${chunkText}\n\n${unit.text}`;
      if (candidate.length > maxChars) {
        break;
      }
      const start = chunkText.length + 2;
      chunkText = candidate;
      spans.push({
        end: chunkText.length,
        headingContext: unit.headingContext,
        start,
      });
      i += 1;
    }

    const text = chunkText.trim();
    if (text) {
      chunks.push({
        headingContext: spans[0]?.headingContext ?? '',
        index: chunks.length,
        text,
        tokenCount: Math.round(text.length / 4),
      });
    }

    if (overlapChars > 0 && i < units.length) {
      const overlapStart = Math.max(0, chunkText.length - overlapChars);
      const carrier =
        spans.find(
          span => overlapStart >= span.start && overlapStart < span.end,
        ) ?? spans.find(span => span.start >= overlapStart);
      overlapHeading = carrier?.headingContext ?? '';
      overlapText = chunkText.slice(overlapStart).replace(/^\n+/, '');
    } else {
      overlapText = '';
      overlapHeading = '';
    }
  }

  return chunks;
}
