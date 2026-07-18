import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

export type MarkdownBlockKind = 'code' | 'heading' | 'other';

// A top-level CommonMark block located by source offset. remark is used as a
// boundary finder, never a serializer: callers slice the *original* string at
// these offsets so truncate/chunk return byte-for-byte slices of the Turndown
// output rather than a reflowed re-stringification.
export interface MarkdownBlock {
  readonly depth: number;
  readonly end: number;
  readonly kind: MarkdownBlockKind;
  readonly start: number;
}

const processor = unified().use(remarkParse).use(remarkGfm);

const HEADING_MARKERS = /^#{1,6}\s+/;

export function parseBlocks(source: string): MarkdownBlock[] {
  const tree = processor.parse(source);
  const blocks: MarkdownBlock[] = [];
  for (const node of tree.children) {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) {
      continue;
    }
    const kind: MarkdownBlockKind =
      node.type === 'code'
        ? 'code'
        : node.type === 'heading'
          ? 'heading'
          : 'other';
    const depth = node.type === 'heading' ? node.depth : 0;
    blocks.push({ depth, end, kind, start });
  }
  return blocks;
}

export function headingText(raw: string): string {
  return raw.replace(HEADING_MARKERS, '').trim();
}
