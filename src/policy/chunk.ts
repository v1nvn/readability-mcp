// Token-bounded chunking of extracted markdown for RAG/embedding. The
// `chars/4` estimator mirrors policy/metadata.ts so a chunk's `tokenCount` is
// directly comparable to `metadata.tokenEstimate`.

export interface Chunk {
  readonly headingContext: string;
  readonly index: number;
  readonly text: string;
  readonly tokenCount: number;
}

export type ChunkStrategy = 'char' | 'semantic';

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
// avoids that.
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

function chunkMarkdownChar(
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

// --- Semantic strategy ------------------------------------------------------
//
// Break on heading/section boundaries and never split a fenced code block.
// Mirrors truncate.ts's fence awareness: a ```/~~~ line toggles fenced state,
// and the whole fenced block (opening fence … closing fence) is one atomic
// unit — boundaries inside a fence (blank lines, `#` lines) are ignored.

// A fence delimiter opens or closes a CommonMark fenced code block: 0-3 spaces
// of indentation followed by ``` or ~~~ (3+). Loose (matches truncate.ts) —
// indented or info-string-bearing fences both toggle.
const FENCE_DELIMITER = /^[ ]{0,3}(`{3,}|~{3,})/;

type SemanticUnitKind = 'code' | 'heading' | 'text';

interface SemanticUnit {
  readonly headingContext: string;
  readonly kind: SemanticUnitKind;
  readonly text: string;
}

interface SemanticSection {
  readonly headingContext: string;
  readonly units: readonly SemanticUnit[];
}

// A group is the unit-list slice that becomes one chunk's body, plus the
// heading-context of its first non-carrier unit (so prepending an overlap
// carrier cannot steal the heading's context).
interface SemanticGroup {
  readonly headingContext: string;
  readonly units: readonly SemanticUnit[];
}

const HEADING_LINE = /^(#{1,6})\s/;

function isFenceDelimiter(line: string): boolean {
  return FENCE_DELIMITER.test(line);
}

function parseSemanticUnits(markdown: string): SemanticUnit[] {
  const lines = markdown.split('\n');
  const units: SemanticUnit[] = [];
  const stack: { level: number; text: string }[] = [];
  let insideFence = false;
  let fenceBuffer: string[] = [];
  let paraBuffer: string[] = [];

  function context(): string {
    return stack.map(h => h.text).join(' > ');
  }

  function flushPara(): void {
    if (paraBuffer.length === 0) {
      return;
    }
    const text = paraBuffer.join('\n').trim();
    if (text) {
      units.push({ headingContext: context(), kind: 'text', text });
    }
    paraBuffer = [];
  }

  function flushFence(): void {
    if (fenceBuffer.length === 0) {
      return;
    }
    units.push({
      headingContext: context(),
      kind: 'code',
      text: fenceBuffer.join('\n'),
    });
    fenceBuffer = [];
  }

  for (const line of lines) {
    if (isFenceDelimiter(line)) {
      if (insideFence) {
        fenceBuffer.push(line);
        flushFence();
        insideFence = false;
      } else {
        flushPara();
        fenceBuffer.push(line);
        insideFence = true;
      }
      continue;
    }
    if (insideFence) {
      fenceBuffer.push(line);
      continue;
    }
    const headingMatch = HEADING_LINE.exec(line);
    if (headingMatch) {
      flushPara();
      const level = headingMatch[1].length;
      const text = line.replace(/^#{1,6}\s+/, '').trim();
      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }
      stack.push({ level, text });
      units.push({ headingContext: context(), kind: 'heading', text: line });
      continue;
    }
    if (line.trim() === '') {
      flushPara();
      continue;
    }
    paraBuffer.push(line);
  }
  flushPara();
  // Unterminated fence: emit what we captured so it survives rather than
  // vanishing. Defensive — never throw on degenerate input.
  flushFence();
  return units;
}

// A section = a heading unit plus its following non-heading units until the
// next heading. Pre-first-heading content forms its own section with an empty
// hierarchy path.
function groupSections(units: readonly SemanticUnit[]): SemanticSection[] {
  const sections: SemanticSection[] = [];
  let current: SemanticUnit[] = [];
  let currentContext = '';

  function flush(): void {
    if (current.length > 0) {
      sections.push({ headingContext: currentContext, units: current });
      current = [];
    }
  }

  for (const unit of units) {
    if (unit.kind === 'heading') {
      flush();
      current = [unit];
      currentContext = unit.headingContext;
    } else {
      if (current.length === 0) {
        currentContext = unit.headingContext;
      }
      current.push(unit);
    }
  }
  flush();
  return sections;
}

function joinedLength(units: readonly SemanticUnit[]): number {
  if (units.length === 0) {
    return 0;
  }
  let total = units[0].text.length;
  for (let i = 1; i < units.length; i++) {
    total += 2 + units[i].text.length;
  }
  return total;
}

// Hard-split a text unit that alone exceeds the budget — line-aware first, then
// hard-split any oversized line. Only ever applied to paragraphs; code blocks
// are never passed through here.
function splitOversizedTextUnit(
  unit: SemanticUnit,
  maxChars: number,
): SemanticUnit[] {
  const lines = unit.text.split('\n');
  const pieces: string[] = [];
  let buffer = '';
  function flush(): void {
    if (buffer) {
      pieces.push(buffer);
      buffer = '';
    }
  }
  for (const line of lines) {
    if (line.length > maxChars) {
      flush();
      for (let i = 0; i < line.length; i += maxChars) {
        pieces.push(line.slice(i, i + maxChars));
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
  return pieces.map(piece => ({
    headingContext: unit.headingContext,
    kind: 'text',
    text: piece,
  }));
}

// Pack sections into chunk groups <= maxChars, preferring heading boundaries.
// A section that fits is never split; an oversized section is split into
// sub-chunks by body unit (paragraphs may split; code blocks never do).
function buildBaseGroups(
  sections: readonly SemanticSection[],
  maxChars: number,
): SemanticUnit[][] {
  const groups: SemanticUnit[][] = [];
  let current: SemanticUnit[] = [];
  let currentLen = 0;

  function emit(): void {
    if (current.length > 0) {
      groups.push(current);
      current = [];
      currentLen = 0;
    }
  }

  function append(unit: SemanticUnit): void {
    const sep = current.length > 0 ? 2 : 0;
    current.push(unit);
    currentLen += sep + unit.text.length;
  }

  for (const section of sections) {
    const sectionLen = joinedLength(section.units);

    const sep = current.length > 0 ? 2 : 0;
    if (currentLen + sep + sectionLen <= maxChars) {
      for (const unit of section.units) {
        append(unit);
      }
      continue;
    }

    // Doesn't fit merged — close the current group and retry the section alone
    // so it has first dibs on the next group (it may still merge with a later
    // section that fits behind it).
    emit();

    if (sectionLen <= maxChars) {
      for (const unit of section.units) {
        append(unit);
      }
      continue;
    }

    // Oversized section: pack body units under the heading; split oversized
    // paragraphs, emit oversized code blocks whole.
    const [headingUnit, ...body] = section.units;
    current.push(headingUnit);
    currentLen = headingUnit.text.length;
    for (const unit of body) {
      if (unit.kind === 'code' && unit.text.length > maxChars) {
        // Semantic never splits a code fence: a fence cut mid-way is
        // unrecoverable, so the block is emitted as its own chunk even though
        // it exceeds the token budget. Deliberate tradeoff vs. the char cap.
        emit();
        groups.push([unit]);
        continue;
      }
      const sepNow = current.length > 0 ? 2 : 0;
      if (
        unit.text.length <= maxChars &&
        currentLen + sepNow + unit.text.length <= maxChars
      ) {
        append(unit);
        continue;
      }
      const pieces =
        unit.text.length > maxChars
          ? splitOversizedTextUnit(unit, maxChars)
          : [unit];
      for (const piece of pieces) {
        const pieceSep = current.length > 0 ? 2 : 0;
        if (
          current.length > 0 &&
          currentLen + pieceSep + piece.text.length > maxChars
        ) {
          emit();
        }
        append(piece);
      }
    }
    // Leave the trailing sub-chunk in `current` so a following section can
    // merge into it if it fits.
  }
  emit();
  return groups;
}

// Carry the trailing text (non-code) units from the previous group as the
// prefix of the next, up to overlapChars. Never carry into or out of a code
// block: a trailing code run is skipped, then contiguous text units before it
// are carried (stop at the first heading or code block encountered).
function applySemanticOverlap(
  groups: readonly SemanticUnit[][],
  overlapChars: number,
): SemanticGroup[] {
  const result: SemanticGroup[] = [];
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const carrier: SemanticUnit[] = [];
    if (i > 0 && overlapChars > 0) {
      const prev = groups[i - 1];
      let end = prev.length;
      while (end > 0 && prev[end - 1].kind === 'code') {
        end -= 1;
      }
      let carrierLen = 0;
      for (let j = end - 1; j >= 0; j--) {
        const unit = prev[j];
        if (unit.kind !== 'text') {
          break;
        }
        const sep = carrier.length > 0 ? 2 : 0;
        if (carrierLen + sep + unit.text.length > overlapChars) {
          break;
        }
        carrier.unshift(unit);
        carrierLen += sep + unit.text.length;
      }
    }
    const units = carrier.length === 0 ? group : [...carrier, ...group];
    result.push({
      // The chunk's heading context follows its first non-carrier unit, so a
      // heading-leading chunk keeps its heading's path even with overlap.
      headingContext: group[0]?.headingContext ?? '',
      units,
    });
  }
  return result;
}

function chunkMarkdownSemantic(
  markdown: string,
  options: Readonly<ChunkOptions>,
): Chunk[] {
  if (!markdown) {
    return [];
  }
  const maxTokens = Math.max(1, Math.floor(options.maxTokens));
  const maxChars = maxTokens * 4;
  const overlapTokens = Math.max(0, Math.floor(options.overlap));
  const overlapChars = Math.min(overlapTokens * 4, maxChars - 1);

  const units = parseSemanticUnits(markdown);
  if (units.length === 0) {
    return [];
  }
  const sections = groupSections(units);
  const baseGroups = buildBaseGroups(sections, maxChars);
  const groups = applySemanticOverlap(baseGroups, overlapChars);

  const chunks: Chunk[] = [];
  for (const group of groups) {
    if (group.units.length === 0) {
      continue;
    }
    const text = group.units
      .map(unit => unit.text)
      .join('\n\n')
      .trim();
    if (!text) {
      continue;
    }
    chunks.push({
      headingContext: group.headingContext,
      index: chunks.length,
      text,
      tokenCount: Math.round(text.length / 4),
    });
  }
  return chunks;
}

export function chunkMarkdown(
  markdown: string,
  options: Readonly<ChunkOptions>,
): Chunk[] {
  if (options.strategy === 'semantic') {
    return chunkMarkdownSemantic(markdown, options);
  }
  return chunkMarkdownChar(markdown, options);
}
