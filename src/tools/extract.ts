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
import { assembleDiagnostics, TraceCollector } from '../policy/diagnostics.js';
import { extractViaFallback } from '../policy/fallback.js';
import { detectGating } from '../policy/gating.js';
import { collectImageInventory } from '../policy/images.js';
import { resolveMetadata } from '../policy/metadata.js';
import { detectPagination } from '../policy/pagination.js';
import { resolveReadabilityOptions } from '../policy/resolver.js';
import { computeTextMetrics } from '../policy/text.js';
import { truncateMarkdown } from '../policy/truncate.js';
import * as cache from '../resources.js';
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
    cache: useCache,
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
    imageInventory,
    debug,
  } = args;

  // Cache hit short-circuits the pipeline. A clone is returned so the cache
  // field can be overwritten to reflect *this* call's hashes (normalizedHash is
  // stable across re-renders, but originalHash differs by nonce/CSP/…).
  if (useCache) {
    const hit = cache.lookup(html, args);
    if (hit) {
      const cloned = JSON.parse(
        JSON.stringify(hit.entry.structuredContent),
      ) as {
        [key: string]: unknown;
        diagnostics: Record<string, unknown>;
      };
      const structuredContent = {
        ...cloned,
        diagnostics: {
          ...cloned.diagnostics,
          cache: {
            hit: true,
            normalizedHash: hit.normalizedHash,
            originalHash: hit.originalHash,
          },
        },
      };
      return {
        content: [{ text: hit.entry.contentText, type: 'text' }],
        structuredContent,
      };
    }
  }

  // Stages are timed at the orchestrator boundary so they stay non-overlapping
  // and sum to the pipeline's wall-clock — stripConsent/absolutize live inside
  // normalize/turndown respectively and aren't carved out as their own stages.
  const trace = new TraceCollector(debug);

  const { document, window } = buildDocument(html, url);
  // Paywall overlays are stripped by normalizeDocument's stripChrome (a Piano
  // modal is role="dialog" + full-viewport fixed), so gating must be detected
  // before normalization. Pagination chrome survives stripChrome and is detected after.
  const {
    gating,
    documentElementCount,
    normalizeCounts,
    imagesResolved,
    pagination,
  } = trace.run('normalize', () => {
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
    return {
      documentElementCount,
      gating,
      imagesResolved,
      normalizeCounts,
      pagination,
    };
  });

  const { readerable, article } = trace.run('readability', () => {
    const readerable = isReaderable(document);
    const readabilityOptions = resolveReadabilityOptions({
      extraction,
      keepClasses,
      maxNodes,
      minArticleLength,
      readabilityOverrides,
    });
    const article = parseArticle(document, readabilityOptions);
    return { article, readerable };
  });

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
    const articleHtml = article.content;
    const sanitized = trace.run(
      'sanitize',
      (): {
        counts: SanitizationDiagnostics;
        html: string;
      } => {
        if (!shouldSanitize) {
          return { counts: { iframes: 0, scripts: 0 }, html: articleHtml };
        }
        const res = sanitizeHtml(articleHtml, window);
        return {
          counts: { iframes: res.iframesRemoved, scripts: res.scriptsRemoved },
          html: res.html,
        };
      },
    );
    sanitizedHtml = sanitized.html;
    sanitizeCounts = sanitized.counts;
    markdown = trace.run('turndown', () =>
      toMarkdown(sanitizedHtml, {
        codeBlockStyle,
        gfm,
        headingStyle,
        images,
        tables,
        url,
      }),
    );
  } else {
    // Cascade only on parse failure, not on isProbablyReaderable.
    // Fallback owns sanitize + turndown internally, so the two stages collapse
    // into one timed block here — keeping the trace non-overlapping.
    const fallback = trace.run('fallback', () =>
      extractViaFallback(document, {
        codeBlockStyle,
        gfm,
        headingStyle,
        images,
        sanitize: shouldSanitize,
        tables,
        url,
        window,
      }),
    );
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

  const { metadata } = trace.run('metadata', () => {
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
    return { metadata };
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
    trace: trace.collect(),
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

  // Runs against sanitizedHtml so the inventory reflects exactly what the host
  // sees in content[0].text — post-sanitization, post-lazy-resolution.
  const imageInventoryEntries = imageInventory
    ? collectImageInventory(sanitizedHtml, window, url)
    : undefined;

  const baseStructuredContent = {
    schemaVersion: 1 as const,
    content: payload,
    metadata,
    diagnostics,
    ...(chunks ? { chunks } : {}),
    ...(imageInventoryEntries ? { images: imageInventoryEntries } : {}),
  };

  // On cache miss (when cache:true), persist a cache-agnostic copy so the
  // stored entry never carries a stale hit/miss verdict, then surface the
  // signal on the returned object only.
  let structuredContent = baseStructuredContent;
  if (useCache) {
    const stored = cache.storeResult(html, args, {
      contentText: payload,
      structuredContent: baseStructuredContent,
    });
    structuredContent = {
      ...baseStructuredContent,
      diagnostics: {
        ...diagnostics,
        cache: {
          hit: false,
          normalizedHash: stored.normalizedHash,
          originalHash: stored.originalHash,
        },
      },
    };
  }

  return {
    content: [{ text: payload, type: 'text' }],
    structuredContent,
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
