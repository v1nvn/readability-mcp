import type { ToolHandle } from '../server.js';

import { ExtractionError, toErrorResult } from '../errors.js';
import { logger } from '../logger.js';
import { buildDocument } from '../pipeline/dom.js';
import { normalizeDocument } from '../pipeline/normalize.js';
import { scopeToHeading } from '../policy/section.js';
import { extractArticle } from './extract.js';
import { outputSchemaShape } from './output-schema.js';
import {
  extractSectionInputSchema,
  extractSectionInputShape,
} from './schemas.js';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const SECTION_SCOPE_SELECTOR = '[data-rdrm-section-scope]';

export function extractSection(rawArgs: unknown): CallToolResult {
  const args = extractSectionInputSchema.parse(rawArgs);
  const { html, url, selector, heading } = args;

  if (selector !== undefined) {
    return extractArticle({ html, url, selectors: { include: selector } });
  }
  // The superRefine on the schema enforces selector/heading XOR, so reaching
  // here means heading is set — but its declared type is still optional, so
  // narrow explicitly rather than asserting.
  if (heading === undefined) {
    throw new ExtractionError(
      'Provide exactly one of `selector` or `heading`.',
    );
  }

  // Heading mode: wrap the matched subtree, re-serialize, and route through
  // extractArticle's selectors.include so this tool stays a thin resolver over
  // the existing extraction pipeline — no forked extraction logic.
  // The DOM is parsed+normalized twice: here to scope against a normalized
  // DOM, and again inside extractArticle — which owns detectGating-before-
  // normalize, resolveLazyImages, and applySelectors. Folding scoping into
  // that pipeline would breach its invariants for a non-hot path; accepted.
  const { document } = buildDocument(html, url);
  normalizeDocument(document);
  if (!scopeToHeading(document, heading)) {
    throw new ExtractionError(`no heading matched: ${heading}`);
  }
  const scoped = `<!DOCTYPE html><html><head></head><body>${document.body.innerHTML}</body></html>`;
  return extractArticle({
    html: scoped,
    url,
    selectors: { include: SECTION_SCOPE_SELECTOR },
  });
}

export const EXTRACT_SECTION_TOOL_DESCRIPTION = `Extract one section of an already-rendered (post-JavaScript) HTML document and return its Markdown + metadata + diagnostics — a thin resolver over extract’s \`selectors.include\` path, not a new extractor. Pick the section by CSS \`selector\` (passed straight through) OR by \`heading\` text (case-insensitive, first match wins; the section spans from the matched heading to the next same-or-higher-level heading). Exactly one of \`selector\`/\`heading\` is required. The server fetches nothing: \`html\` is the only source, and \`url\` (optional) is origin context only (never fetched).`;

export function extractSectionHandler(args: unknown): CallToolResult {
  try {
    return extractSection(args);
  } catch (err) {
    logger.error(
      `extract_section failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return toErrorResult(err);
  }
}

export function registerExtractSectionTool(server: McpServer): ToolHandle {
  return server.registerTool(
    'extract_section',
    {
      title: 'Extract one section by selector or heading',
      description: EXTRACT_SECTION_TOOL_DESCRIPTION,
      inputSchema: extractSectionInputShape,
      outputSchema: outputSchemaShape,
    },
    extractSectionHandler,
  );
}
