import type { SanitizationDiagnostics } from '../pipeline/context.js';
import type { ToolHandle } from '../server.js';

import { ExtractionError, toErrorResult } from '../errors.js';
import { logger } from '../logger.js';
import { formatPayload } from '../output/format.js';
import { buildDocument } from '../pipeline/dom.js';
import { normalizeDocument, resolveLazyImages } from '../pipeline/normalize.js';
import { isReaderable, parseArticle } from '../pipeline/readability.js';
import { sanitizeHtml } from '../pipeline/sanitize.js';
import { toMarkdown } from '../pipeline/turndown.js';
import { assembleDiagnostics } from '../policy/diagnostics.js';
import { extractViaFallback } from '../policy/fallback.js';
import { resolveMetadata } from '../policy/metadata.js';
import { resolveReadabilityOptions } from '../policy/resolver.js';
import { truncateMarkdown } from '../policy/truncate.js';
import { outputSchemaShape } from './output-schema.js';
import { extractInputSchema, extractInputShape } from './schemas.js';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// Names the extraction path, not a DOM tag — Readability doesn't expose the source node.
const EXTRACTED_NODE = 'readability';

function countWords(text: string): number {
  return (text.match(/\S+/g) ?? []).length;
}

function applySelectors(
  document: Document,
  selectors:
    | undefined
    | { readonly exclude?: readonly string[]; readonly include?: string },
): void {
  if (!selectors) {
    return;
  }
  if (selectors.exclude) {
    for (const selector of selectors.exclude) {
      document.querySelectorAll(selector).forEach(el => {
        el.remove();
      });
    }
  }
  if (selectors.include) {
    const body = document.body;
    const root = body.querySelector(selectors.include);
    if (root && root !== body) {
      body.innerHTML = '';
      body.appendChild(root);
    }
  }
}

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
  } = args;

  const { document, window } = buildDocument(html, url);
  const documentElementCount = document.querySelectorAll('*').length;

  const normalizeCounts = normalizeDocument(document, { cleanChrome });
  const imagesResolved = resolveLazyImages(document);
  applySelectors(document, selectors);

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

  const wordCount = countWords(textContent);
  const readingTimeMin =
    wordCount === 0 ? 0 : Math.max(1, Math.round(wordCount / wordsPerMinute));
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
    chromeRemoved: normalizeCounts.chromeRemoved,
    documentElementCount,
    extractedNode,
    fallbackUsed,
    imagesResolved,
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

  return {
    content: [{ text: payload, type: 'text' }],
    structuredContent: {
      schemaVersion: 1,
      content: payload,
      metadata,
      diagnostics,
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
      description: EXTRACT_TOOL_DESCRIPTION,
      inputSchema: extractInputShape,
      outputSchema: outputSchemaShape,
    },
    extractHandler,
  );
}
