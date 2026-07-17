import type { Metadata } from '../pipeline/context.js';
import type { ToolHandle } from '../server.js';

import { toErrorResult } from '../errors.js';
import { logger } from '../logger.js';
import { buildDocument } from '../pipeline/dom.js';
import { normalizeDocument } from '../pipeline/normalize.js';
import { resolveMetadata } from '../policy/metadata.js';
import { extractMetadataOutputShape } from './output-schema.js';
import {
  extractMetadataInputSchema,
  extractMetadataInputShape,
} from './schemas.js';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// Bibliographic fields only — wordCount/readingTimeMin/tokenEstimate are
// meaningless without the extracted body, so a metadata-only caller never
// sees wordCount: 0.
const BIBLIOGRAPHIC_KEYS = [
  'title',
  'byline',
  'siteName',
  'lang',
  'publishedTime',
  'excerpt',
  'canonical',
  'url',
] as const satisfies readonly (keyof Metadata)[];

function pickBibliographic(
  metadata: Readonly<Metadata>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of BIBLIOGRAPHIC_KEYS) {
    const value = metadata[key];
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

// One line per present field; never blank so content[0].text is always scannable.
function renderMetadataLines(
  metadata: Readonly<Record<string, string>>,
): string {
  const lines = Object.entries(metadata).map(
    ([key, value]) => `${key}: ${value}`,
  );
  return lines.length > 0 ? lines.join('\n') : '(no metadata found)';
}

export function extractMetadataDocument(rawArgs: unknown): CallToolResult {
  const args = extractMetadataInputSchema.parse(rawArgs);
  const { html, url } = args;

  const { document } = buildDocument(html, url);
  normalizeDocument(document);
  const resolved = resolveMetadata({
    document,
    textContent: '',
    wordCount: 0,
    readingTimeMin: 0,
    url,
  });

  const metadata = pickBibliographic(resolved);
  const content = renderMetadataLines(metadata);
  return {
    content: [{ text: content, type: 'text' }],
    structuredContent: {
      schemaVersion: 1,
      content,
      metadata,
    },
  };
}

export const EXTRACT_METADATA_TOOL_DESCRIPTION = `Return only the bibliographic metadata (title, byline, siteName, lang, publishedTime, excerpt, canonical, url) of already-rendered (post-JavaScript) HTML without running Readability/Turndown — a fast pre-check for crawlers and citation. Resolves the same metadata cascade as \`extract\` (JSON-LD → OpenGraph → Twitter → <meta> → <time> → <title>), plus <link rel="canonical"> → og:url. The server fetches nothing: \`html\` is the only source, and \`url\` is origin context only (never fetched).`;

export function extractMetadataHandler(args: unknown): CallToolResult {
  try {
    return extractMetadataDocument(args);
  } catch (err) {
    logger.error(
      `extract_metadata failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return toErrorResult(err);
  }
}

export function registerExtractMetadataTool(server: McpServer): ToolHandle {
  return server.registerTool(
    'extract_metadata',
    {
      title: 'Extract metadata only (no Readability)',
      description: EXTRACT_METADATA_TOOL_DESCRIPTION,
      inputSchema: extractMetadataInputShape,
      outputSchema: extractMetadataOutputShape,
    },
    extractMetadataHandler,
  );
}
