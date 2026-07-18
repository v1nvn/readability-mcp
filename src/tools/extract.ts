import type { SanitizationDiagnostics } from '../pipeline/context.js';
import type { ToolHandle } from '../server.js';

import { ExtractionError, toErrorResult } from '../errors.js';
import { logger } from '../logger.js';
import { formatPayload } from '../output/format.js';
import { buildDocument } from '../pipeline/dom.js';
import {
  applySelectors,
  canonicalizeCodeBlocks,
  normalizeDocument,
  resolveLazyImages,
} from '../pipeline/normalize.js';
import { isReaderable, parseArticle } from '../pipeline/readability.js';
import { sanitizeHtml } from '../pipeline/sanitize.js';
import { toMarkdown } from '../pipeline/turndown.js';
import { chunkMarkdown } from '../policy/chunk.js';
import { assembleDiagnostics } from '../policy/diagnostics.js';
import { extractViaFallback } from '../policy/fallback.js';
import { detectGating } from '../policy/gating.js';
import { resolveMetadata } from '../policy/metadata.js';
import { detectPagination } from '../policy/pagination.js';
import { resolveReadabilityOptions } from '../policy/resolver.js';
import { computeTextMetrics } from '../policy/text.js';
import { truncateMarkdown } from '../policy/truncate.js';
import { outputSchemaShape } from './output-schema.js';
import { extractInputSchema, extractInputShape } from './schemas.js';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// Names the extraction path, not a DOM tag — Readability doesn't expose the source node.
const EXTRACTED_NODE = 'readability';

export function extractArticle(rawArgs: unknown): CallToolResult {
  const args = extractInputSchema.parse(rawArgs);
  const {
    html,
    url,
    selectors,
    extraction,
    minArticleLength,
    maxNodes,
    keepClasses,
    readabilityOverrides,
    format,
    metadataMode,
    gfm,
    headingStyle,
    codeBlockStyle,
    images,
    sanitize: shouldSanitize,
    maxChars,
    wordsPerMinute,
    cleanChrome,
    tables,
    chunk,
  } = args;

  const { document, window } = buildDocument(html, url);
  // Paywall overlays are stripped by normalizeDocument's stripChrome (a Piano
  // modal is role="dialog" + full-viewport fixed), so gating must be detected
  // before normalization. Pagination chrome survives stripChrome and is detected after.
  const gating = detectGating(document);
  const documentElementCount = document.querySelectorAll('*').length;

  const normalizeCounts = normalizeDocument(document, { cleanChrome });
  const imagesResolved = resolveLazyImages(document);
  // Detect before applySelectors: a caller's selectors.include could scope the
  // body and hide pagination chrome, but "more content exists" is still true.
  const pagination = detectPagination(document, url);
  applySelectors(document, selectors);
  const codeBlocksCanonicalized = canonicalizeCodeBlocks(document);
  if (codeBlocksCanonicalized > 0) {
    logger.debug(
      `canonicalized ${codeBlocksCanonicalized} code-block language tag(s)`,
    );
  }

  const readerable = isReaderable(document);
  const readabilityOptions = resolveReadabilityOptions({
    extraction,
    keepClasses,
    maxNodes,
    minArticleLength,
    readabilityOverrides,
  });
  const article = parseArticle(document, readabilityOptions);

  let markdown: string;
  let sanitizedHtml: string;
  let textContent: string;
  let extractedNode: string;
  let fallbackUsed: boolean;
  let sanitizeCounts: SanitizationDiagnostics;

  if (article?.content) {
    extractedNode = EXTRACTED_NODE;
    fallbackUsed = false;
    textContent = article.textContent ?? '';
    let raw = article.content;
    if (shouldSanitize) {
      const res = sanitizeHtml(article.content, window);
      raw = res.html;
      sanitizeCounts = {
        iframes: res.iframesRemoved,
        scripts: res.scriptsRemoved,
      };
    } else {
      sanitizeCounts = { iframes: 0, scripts: 0 };
    }
    sanitizedHtml = raw;
    markdown = toMarkdown(sanitizedHtml, {
      codeBlockStyle,
      gfm,
      headingStyle,
      images,
      tables,
      url,
    });
  } else {
    // Cascade only on parse failure, not on isProbablyReaderable.
    const fallback = extractViaFallback(document, {
      codeBlockStyle,
      gfm,
      headingStyle,
      images,
      sanitize: shouldSanitize,
      tables,
      url,
      window,
    });
    if (!fallback) {
      throw new ExtractionError(
        'Readability returned no article and the selector cascade yielded no usable content.',
      );
    }
    extractedNode = fallback.rootSelector;
    fallbackUsed = true;
    markdown = fallback.markdown;
    sanitizedHtml = fallback.sanitizedHtml;
    textContent = fallback.textContent;
    sanitizeCounts = fallback.sanitization;
  }

  const { wordCount, readingTimeMin } = computeTextMetrics(
    textContent,
    wordsPerMinute,
  );
  const metadata = resolveMetadata({
    document,
    readability: article,
    readingTimeMin,
    textContent,
    url,
    wordCount,
  });

  const sanitization: SanitizationDiagnostics = {
    iframes: normalizeCounts.iframes + sanitizeCounts.iframes,
    scripts: normalizeCounts.scripts + sanitizeCounts.scripts,
  };
  const baseDiagnostics = assembleDiagnostics({
    articleHtml: sanitizedHtml,
    boilerplateRemoved: normalizeCounts.boilerplateRemoved,
    chromeRemoved: normalizeCounts.chromeRemoved,
    documentElementCount,
    extractedNode,
    fallbackUsed,
    gated: gating,
    imagesResolved,
    pagination,
    readerable,
    sanitization,
    truncated: false,
    window,
  });

  let payload = formatPayload({
    diagnostics: baseDiagnostics,
    format,
    markdown,
    metadata,
    metadataMode,
    sanitizedHtml,
    textContent,
  });

  let truncated = false;
  if (maxChars !== undefined && (format === 'markdown' || format === 'text')) {
    const res = truncateMarkdown(payload, maxChars);
    payload = res.text;
    truncated = res.truncated;
  }
  const diagnostics = truncated
    ? { ...baseDiagnostics, truncated }
    : baseDiagnostics;

  // Chunk the final payload (post-format, post-truncation) so token counts
  // reflect what the host sees in content[0].text. HTML/JSON formats carry no
  // markdown body to slice, so `chunks` stays unset for them.
  const chunks =
    chunk && (format === 'markdown' || format === 'text')
      ? chunkMarkdown(payload, chunk)
      : undefined;

  return {
    content: [{ text: payload, type: 'text' }],
    structuredContent: {
      schemaVersion: 1,
      content: payload,
      metadata,
      diagnostics,
      ...(chunks ? { chunks } : {}),
    },
  };
}

export const EXTRACT_TOOL_DESCRIPTION = `Extract the main article from already-rendered (post-JavaScript) HTML and return clean Markdown plus metadata and diagnostics. The server fetches nothing: \`html\` is the only source, and \`url\` (optional) is used solely to absolutize relative links. Hand it the output of \`document.documentElement.outerHTML\` from a browser/devtools capture.`;

export function extractHandler(args: unknown): CallToolResult {
  try {
    return extractArticle(args);
  } catch (err) {
    logger.error(
      `extract failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return toErrorResult(err);
  }
}

export function registerExtractTool(server: McpServer): ToolHandle {
  return server.registerTool(
    'extract',
    {
      title: 'Extract article to Markdown',
      description: EXTRACT_TOOL_DESCRIPTION,
      inputSchema: extractInputShape,
      outputSchema: outputSchemaShape,
    },
    extractHandler,
  );
}
