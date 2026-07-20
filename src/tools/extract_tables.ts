import type { ToolHandle } from '../server.js';

import { toErrorResult } from '../errors.js';
import { logger } from '../logger.js';
import { buildDocument } from '../pipeline/dom.js';
import { applySelectors } from '../pipeline/normalize.js';
import { parseTableMatrix, renderTable } from '../policy/tables.js';
import { readHtmlFile } from './html-source.js';
import { extractTablesOutputShape } from './output-schema.js';
import {
  type ExtractTablesFromHtmlInput,
  type ExtractTablesInput,
  extractTablesInputSchema,
  extractTablesInputShape,
} from './schemas.js';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

interface ExtractedTable {
  readonly cols: number;
  readonly index: number;
  readonly markdown: string;
  readonly rows: number;
}

const NO_TABLES = '(no tables found)';

export function extractTables(rawArgs: unknown): CallToolResult {
  const { localPath, ...rest } = extractTablesInputSchema.parse(rawArgs);
  return extractTablesFromHtml({ html: readHtmlFile(localPath), ...rest });
}

// Schema defaults for callers that pass only a subset of the knobs (format).
const DEFAULTS: Omit<ExtractTablesInput, 'localPath'> =
  extractTablesInputSchema.parse({ localPath: '' });

export function extractTablesFromHtml(
  input: Readonly<ExtractTablesFromHtmlInput>,
): CallToolResult {
  const { html, baseUrl, format, selectors } = { ...DEFAULTS, ...input };

  // Skip normalizeDocument/Readability on purpose: this tool exists to reach
  // tables that live outside the scored article (nav, aside, boilerplate), which
  // those stages would discard. Table structure is static HTML, so the matrix
  // walk is unaffected by unsanitized scripts/styles.
  const { document } = buildDocument(html, baseUrl);
  applySelectors(document, selectors);

  const tables: ExtractedTable[] = [];
  let index = 0;
  for (const table of document.querySelectorAll('table')) {
    const matrix = parseTableMatrix(table);
    if (matrix.length === 0) {
      continue;
    }
    const markdown = renderTable(matrix, format);
    tables.push({
      index,
      rows: matrix.length,
      cols: matrix[0]?.length ?? 0,
      markdown,
    });
    index++;
  }

  const content =
    tables.length > 0
      ? tables.map(entry => entry.markdown).join('\n\n')
      : NO_TABLES;
  return {
    content: [{ text: content, type: 'text' }],
    structuredContent: {
      schemaVersion: 1,
      content,
      tables,
      metadata: { baseUrl, format, tableCount: tables.length },
    },
  };
}

export const EXTRACT_TABLES_TOOL_DESCRIPTION = `Extract every <table> on the page from already-rendered (post-JavaScript) HTML and return each as GFM / CSV / JSON (caller picks). Runs no Readability, Turndown, or sanitization — a page-wide \`querySelectorAll('table')\` walk in front of the same rowspan/colspan-aware matrix serializer used by the \`tables\` option on \`extract\`. Captures tables outside the article body (nav, aside, boilerplate) that the \`tables\` option never sees. The server fetches nothing: \`localPath\` is the only source, and \`baseUrl\` (optional) is origin context only (never fetched).`;

export function extractTablesHandler(args: unknown): CallToolResult {
  try {
    return extractTables(args);
  } catch (err) {
    logger.error(
      `extract_tables failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return toErrorResult(err);
  }
}

export function registerExtractTablesTool(server: McpServer): ToolHandle {
  return server.registerTool(
    'extract_tables',
    {
      title: 'Extract every table on the page',
      description: EXTRACT_TABLES_TOOL_DESCRIPTION,
      inputSchema: extractTablesInputShape,
      outputSchema: extractTablesOutputShape,
    },
    extractTablesHandler,
  );
}
