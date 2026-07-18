import type { ToolHandle } from '../server.js';

import { toErrorResult } from '../errors.js';
import { logger } from '../logger.js';
import { buildDocument } from '../pipeline/dom.js';
import {
  detectList,
  type ListDetectionResult,
  type ListItem,
} from '../policy/list-detector.js';
import { extractListOutputShape } from './output-schema.js';
import { extractListInputSchema, extractListInputShape } from './schemas.js';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const NOT_A_LIST = 'not a list: no repeated item structure with links';

function renderItems(result: ListDetectionResult): string {
  if (!result.detected || result.items.length === 0) {
    return result.note || NOT_A_LIST;
  }
  return result.items
    .map((item, index) => {
      const head = `${index + 1}. ${item.title} — ${item.url}`;
      return item.snippet ? `${head}\n   ${item.snippet}` : head;
    })
    .join('\n');
}

function toStructuredItem(item: ListItem) {
  return {
    score: item.score,
    snippet: item.snippet,
    title: item.title,
    url: item.url,
  };
}

export function extractList(rawArgs: unknown): CallToolResult {
  const args = extractListInputSchema.parse(rawArgs);
  const { html, url } = args;

  // No Readability/Turndown/normalize: list pages survive on raw DOM shape
  // (sibling TR/LI/ARTICLE clusters), and the article normalizer would
  // discard the very chrome-bearing structure the detector scores against.
  // Chrome stripping (nav/header/footer/aside) lives inside detectList so
  // this tool sees the page as captured.
  const { document } = buildDocument(html, url);
  const result = detectList(document, url);
  const content = renderItems(result);
  return {
    content: [{ text: content, type: 'text' }],
    structuredContent: {
      schemaVersion: 1,
      content,
      items: result.items.map(toStructuredItem),
      diagnostics: {
        confidence: result.confidence,
        containerSelector: result.containerSelector,
        detected: result.detected,
        itemCount: result.itemCount,
        itemTag: result.itemTag,
        note: result.note,
      },
      metadata: { url },
    },
  };
}

export const EXTRACT_LIST_TOOL_DESCRIPTION = `Detect and extract a list/feed/index structure from already-rendered (post-JavaScript) HTML — for HN-style, search-result, and blog-index pages that Readability cannot turn into one article. Returns \`{items: [{title, url, snippet, score}], diagnostics}\` instead of one article. Strips nav/header/footer/aside + ARIA chrome roles first (the false-positive guard so an article's nav menu doesn't look like a 4-item feed), then finds the container whose direct children form a same-shape sibling cluster of ≥3 elements each carrying a navigation anchor, and the cluster with the most items wins. No Readability, no Turndown, no sanitization. The server fetches nothing: \`html\` is the only source, and \`url\` (optional) is origin context for absolutizing item hrefs.`;

export function extractListHandler(args: unknown): CallToolResult {
  try {
    return extractList(args);
  } catch (err) {
    logger.error(
      `extract_list failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return toErrorResult(err);
  }
}

export function registerExtractListTool(server: McpServer): ToolHandle {
  return server.registerTool(
    'extract_list',
    {
      title: 'Extract a list/feed (HN/search/blog-index pages)',
      description: EXTRACT_LIST_TOOL_DESCRIPTION,
      inputSchema: extractListInputShape,
      outputSchema: extractListOutputShape,
    },
    extractListHandler,
  );
}
