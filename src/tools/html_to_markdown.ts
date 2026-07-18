import type { SanitizationDiagnostics } from '../pipeline/context.js';
import type { ToolHandle } from '../server.js';

import { toErrorResult } from '../errors.js';
import { logger } from '../logger.js';
import { formatPayload } from '../output/format.js';
import { buildDocument } from '../pipeline/dom.js';
import {
  applySelectors,
  normalizeDocument,
  resolveLazyImages,
} from '../pipeline/normalize.js';
import { sanitizeHtml } from '../pipeline/sanitize.js';
import { toMarkdown } from '../pipeline/turndown.js';
import { assembleDiagnostics } from '../policy/diagnostics.js';
import { computeTextMetrics, nonEmpty } from '../policy/text.js';
import { truncateMarkdown } from '../policy/truncate.js';
import { outputSchemaShape } from './output-schema.js';
import {
  htmlToMarkdownInputSchema,
  htmlToMarkdownInputShape,
} from './schemas.js';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const EXTRACTED_NODE = 'fragment';

export function htmlToMarkdown(rawArgs: unknown): CallToolResult {
  const args = htmlToMarkdownInputSchema.parse(rawArgs);
  const {
    html,
    url,
    selectors,
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
  } = args;

  const { document, window } = buildDocument(html, url);
  const documentElementCount = document.querySelectorAll('*').length;

  const normalizeCounts = normalizeDocument(document, { cleanChrome });
  const imagesResolved = resolveLazyImages(document);
  applySelectors(document, selectors);

  const body = document.body;
  const rawHtml = body.innerHTML;
  const textContent = body.textContent;

  let sanitizedHtml = rawHtml;
  let sanitizeCounts: SanitizationDiagnostics = { iframes: 0, scripts: 0 };
  if (shouldSanitize) {
    const res = sanitizeHtml(rawHtml, window);
    sanitizedHtml = res.html;
    sanitizeCounts = {
      iframes: res.iframesRemoved,
      scripts: res.scriptsRemoved,
    };
  }
  const markdown = toMarkdown(sanitizedHtml, {
    codeBlockStyle,
    gfm,
    headingStyle,
    images,
    tables,
    url,
  });

  const firstHeading = nonEmpty(
    body.querySelector('h1, h2, h3, h4, h5, h6')?.textContent,
  );
  const metadata = {
    title: firstHeading,
    url,
    ...computeTextMetrics(textContent, wordsPerMinute),
  };

  const sanitization: SanitizationDiagnostics = {
    iframes: normalizeCounts.iframes + sanitizeCounts.iframes,
    scripts: normalizeCounts.scripts + sanitizeCounts.scripts,
  };
  const baseDiagnostics = assembleDiagnostics({
    articleHtml: sanitizedHtml,
    boilerplateRemoved: normalizeCounts.boilerplateRemoved,
    chromeRemoved: normalizeCounts.chromeRemoved,
    documentElementCount,
    extractedNode: EXTRACTED_NODE,
    fallbackUsed: true,
    imagesResolved,
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

export const HTML_TO_MARKDOWN_TOOL_DESCRIPTION = `Convert an arbitrary HTML fragment to Markdown WITHOUT Readability article extraction (e.g. a snippet already isolated via chrome-devtools). Same Turndown + DOMPurify path as \`extract\`. The server fetches nothing: \`html\` is the only source, and \`url\` (optional) absolutizes relative links.`;

export function htmlToMarkdownHandler(args: unknown): CallToolResult {
  try {
    return htmlToMarkdown(args);
  } catch (err) {
    logger.error(
      `html_to_markdown failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return toErrorResult(err);
  }
}

export function registerHtmlToMarkdownTool(server: McpServer): ToolHandle {
  return server.registerTool(
    'html_to_markdown',
    {
      title: 'Convert HTML fragment to Markdown',
      description: HTML_TO_MARKDOWN_TOOL_DESCRIPTION,
      inputSchema: htmlToMarkdownInputShape,
      outputSchema: outputSchemaShape,
    },
    htmlToMarkdownHandler,
  );
}
