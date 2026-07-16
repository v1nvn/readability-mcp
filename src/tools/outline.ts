// The `outline` tool. A cheap "is this worth reading?" pre-check: a flat walk
// of h1-h6 in document order with stable anchor ids, no body content. Unlike
// `extract`/`html_to_markdown` it runs no Readability scoring, Turndown
// conversion, or DOMPurify sanitization — it reuses only the DOM build and
// normalize stages so the heading tree matches what the other tools see.
// `outlineDocument` is the pure fn tests call directly.

import { toErrorResult } from '../errors.js';
import { logger } from '../logger.js';
import { buildDocument } from '../pipeline/dom.js';
import { normalizeDocument } from '../pipeline/normalize.js';
import { resolveOutline } from '../policy/outline.js';
import { outlineOutputShape } from './output-schema.js';
import { outlineInputSchema, outlineInputShape } from './schemas.js';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// Indented markdown bullets — one line per heading, nested by depth. The
// payload is never blank so consumers reading `content[0].text` always see
// something scannable, even when the document has no headings at all.
function renderOutlineToc(
  outline: readonly { level: number; text: string }[],
): string {
  if (outline.length === 0) {
    return '(no headings found)';
  }
  return outline
    .map(entry => `${'  '.repeat(entry.level - 1)}- ${entry.text}`)
    .join('\n');
}

export function outlineDocument(rawArgs: unknown): CallToolResult {
  const args = outlineInputSchema.parse(rawArgs);
  const { html, url } = args;

  const { document } = buildDocument(html, url);
  normalizeDocument(document);
  const outline = resolveOutline(document);

  // Title cascade mirrors the other tools' first-non-empty-wins: the document's
  // <title>, then the first <h1>'s text (whitespace-collapsed), else absent.
  // Element.textContent and document.title are non-null in the DOM types, so
  // the only optional chain is querySelector (which can return null).
  const title =
    document.title.trim() ||
    document.querySelector('h1')?.textContent.replace(/\s+/g, ' ').trim() ||
    undefined;
  const metadata = { title, url };

  const content = renderOutlineToc(outline);
  return {
    content: [{ text: content, type: 'text' }],
    structuredContent: {
      schemaVersion: 1,
      content,
      outline,
      metadata,
    },
  };
}

export const OUTLINE_TOOL_DESCRIPTION = `Return the document outline (h1-h6 headings with stable anchor ids) of already-rendered (post-JavaScript) HTML as a cheap pre-check before full extraction. No Readability scoring, no Turndown, no sanitization — a pure heading walk. The server fetches nothing: \`html\` is the only source, and \`url\` is origin context only (never fetched).`;

// Exported handler so contract tests can call it directly.
export function outlineHandler(args: unknown): CallToolResult {
  try {
    return outlineDocument(args);
  } catch (err) {
    logger.error(
      `outline failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return toErrorResult(err);
  }
}

export function registerOutlineTool(server: McpServer): void {
  server.registerTool(
    'outline',
    {
      description: OUTLINE_TOOL_DESCRIPTION,
      inputSchema: outlineInputShape,
      outputSchema: outlineOutputShape,
    },
    outlineHandler,
  );
}
