import type { ToolHandle } from '../server.js';

import { toErrorResult } from '../errors.js';
import { logger } from '../logger.js';
import { buildDocument } from '../pipeline/dom.js';
import { applySelectors } from '../pipeline/normalize.js';
import { detectGrid } from '../policy/grid-detector.js';
import { renderTable } from '../policy/tables.js';
import { readHtmlFile } from './html-source.js';
import { extractGridOutputShape } from './output-schema.js';
import {
  type ExtractGridFromHtmlInput,
  type ExtractGridInput,
  extractGridInputSchema,
  extractGridInputShape,
} from './schemas.js';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

interface GridEntry {
  readonly cols: number;
  readonly markdown: string;
  readonly rows: number;
}

const NO_GRID = '(no repeating grid found)';

export function extractGrid(rawArgs: unknown): CallToolResult {
  const { localPath, ...rest } = extractGridInputSchema.parse(rawArgs);
  return extractGridFromHtml({ html: readHtmlFile(localPath), ...rest });
}

// Schema defaults for callers that pass only a subset of the knobs (format).
const DEFAULTS: Omit<ExtractGridInput, 'localPath'> =
  extractGridInputSchema.parse({ localPath: '' });

export function extractGridFromHtml(
  input: Readonly<ExtractGridFromHtmlInput>,
): CallToolResult {
  const { html, baseUrl, format, selectors, rowSelector, cellSelector } = {
    ...DEFAULTS,
    ...input,
  };

  // Same raw-DOM rationale as extract_tables/extract_list: the repeating grid
  // lives in statically-rendered divs that Readability/normalize would discard
  // (nav/aside/boilerplate), and grid shape is unaffected by unsanitized
  // scripts/styles. Chrome stripping lives inside detectGrid (auto mode only)
  // so selector mode sees the page as captured.
  const { document } = buildDocument(html, baseUrl);
  applySelectors(document, selectors);
  const result = detectGrid(document, { rowSelector, cellSelector });

  let content = NO_GRID;
  let grid: GridEntry = { rows: 0, cols: 0, markdown: '' };
  if (result.detected && result.rows.length > 0) {
    const matrix = result.rows.map(row => [...row.cells]);
    const markdown = renderTable(matrix, format);
    content = markdown;
    grid = { rows: result.rowCount, cols: result.colCount, markdown };
  }
  return {
    content: [{ text: content, type: 'text' }],
    structuredContent: {
      schemaVersion: 1,
      content,
      grid,
      diagnostics: {
        confidence: result.confidence,
        containerSelector: result.containerSelector,
        detected: result.detected,
        rowCount: result.rowCount,
        colCount: result.colCount,
        rowTag: result.rowTag,
        note: result.note,
      },
      metadata: { baseUrl, format, detected: result.detected },
    },
  };
}

export const EXTRACT_GRID_TOOL_DESCRIPTION = `Detect and extract a CSS-grid / div "table" from already-rendered (post-JavaScript) HTML — the div equivalent of \`extract_tables\` for SPAs that render data into repeating \`<div>\` rows instead of \`<table>\`. Supports auto-detect (find the container whose direct children form the largest same-shape sibling group of ≥3 rows, each row a set of ≥2 direct element-children) and explicit \`rowSelector\` + \`cellSelector\` selector mode (cells scoped to each row subtree). Renders the matrix through the SAME gfm/csv/json renderer as \`extract_tables\`. Runs no Readability, no Turndown, no sanitization — the server fetches nothing: \`localPath\` is the only source, and \`baseUrl\` (optional) is origin context only.`;

export function extractGridHandler(args: unknown): CallToolResult {
  try {
    return extractGrid(args);
  } catch (err) {
    logger.error(
      `extract_grid failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return toErrorResult(err);
  }
}

export function registerExtractGridTool(server: McpServer): ToolHandle {
  return server.registerTool(
    'extract_grid',
    {
      title:
        'Extract a CSS-grid / div table (the div equivalent of extract_tables)',
      description: EXTRACT_GRID_TOOL_DESCRIPTION,
      inputSchema: extractGridInputShape,
      outputSchema: extractGridOutputShape,
    },
    extractGridHandler,
  );
}
