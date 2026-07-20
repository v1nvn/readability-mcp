import type { ToolHandle } from '../server.js';

import { toErrorResult } from '../errors.js';
import { logger } from '../logger.js';
import { buildDocument } from '../pipeline/dom.js';
import { applySelectors, normalizeDocument } from '../pipeline/normalize.js';
import { resolveOutline } from '../policy/outline.js';
import { outlineOutputShape } from './output-schema.js';
import { outlineInputSchema, outlineInputShape } from './schemas.js';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// One line per heading, nested by depth; never blank so content[0].text is always scannable.
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
  const { html, url, selectors } = args;

  const { document } = buildDocument(html, url);
  normalizeDocument(document);
  applySelectors(document, selectors);
  const outline = resolveOutline(document);

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

export function registerOutlineTool(server: McpServer): ToolHandle {
  return server.registerTool(
    'outline',
    {
      title: 'Get document outline (heading TOC)',
      description: OUTLINE_TOOL_DESCRIPTION,
      inputSchema: outlineInputShape,
      outputSchema: outlineOutputShape,
    },
    outlineHandler,
  );
}
