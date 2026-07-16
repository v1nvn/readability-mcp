// The `extract` tool (DESIGN §5.1). `extractArticle` is a pure function the
// golden/cross-seam tests call directly; `registerExtractTool` is the thin
// McpServer wiring that delegates to it and converts thrown errors to
// `{ isError: true }` results so nothing ever throws across the wire.

import type { SanitizationDiagnostics } from '../pipeline/context.js';

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

// Names the extraction PATH (Readability's main scorer produced content), not a
// DOM tag. Readability does not expose which source node it picked as its top
// candidate, so claiming an `<article>` element exists would be dishonest —
// pages with no `<article>` tag (HN, example.com) previously reported "article".
// The fallback path instead names a real selector (`main`/`[role=main]`/`body`),
// and `html_to_markdown` reports "fragment"; all three are "where the content
// came from" labels.
const EXTRACTED_NODE = 'readability';

function countWords(text: string): number {
  return (text.match(/\S+/g) ?? []).length;
}

// Apply optional selector pruning before Readability. `exclude` drops matched
// boilerplate nodes; `include` scopes the document body to the matched subtree
// so Readability only scores inside it.
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
    // buildDocument always parses a full document with a <body>, so the
    // non-null assertion is structural rather than hopeful.
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
  } = args;

  // 1. Build the DOM with `url` so Readability can absolutize relative links.
  const { document, window } = buildDocument(html, url);
  const documentElementCount = document.querySelectorAll('*').length;

  // 2. Normalize + selector pruning on the pipeline-owned document.
  const normalizeCounts = normalizeDocument(document);
  // Resolve lazy-load image placeholders before Readability clones the document
  // (the clone inherits the corrected src values).
  const imagesResolved = resolveLazyImages(document);
  applySelectors(document, selectors);

  // 3. Readerable guard + Readability parse (parses a private clone).
  const readerable = isReaderable(document);
  const readabilityOptions = resolveReadabilityOptions({
    extraction,
    keepClasses,
    maxNodes,
    minArticleLength,
    readabilityOverrides,
  });
  const article = parseArticle(document, readabilityOptions);

  // 4. Extraction: main article path, or the selector cascade on parse failure.
  // Trust Readability when parse() returns content even if isProbablyReaderable
  // was false — cascade ONLY on parse failure (refinement of DESIGN §5.1).
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

  // 5. Metadata cascade + reading-time math. Resolved against the normalized
  //    document so JSON-LD/OG/Twitter layers surface; Readability fills gaps.
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

  // 6. Diagnostics. Sanitization counts span the whole pipeline: scripts/iframes
  //    dropped by normalize plus those dropped by DOMPurify on the article HTML.
  const sanitization: SanitizationDiagnostics = {
    iframes: normalizeCounts.iframes + sanitizeCounts.iframes,
    scripts: normalizeCounts.scripts + sanitizeCounts.scripts,
  };
  const baseDiagnostics = assembleDiagnostics({
    articleHtml: sanitizedHtml,
    documentElementCount,
    extractedNode,
    fallbackUsed,
    imagesResolved,
    readerable,
    sanitization,
    truncated: false,
    window,
  });

  // 7. Render the text payload (json format embeds diagnostics verbatim), then
  //    apply the length budget (markdown/text only) at a block boundary — never
  //    inside a fenced code block.
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

// The tool handler closure, exported so contract tests can exercise the
// isError path (and structuredContent shape) without spinning up an McpServer.
export function extractHandler(args: unknown): CallToolResult {
  try {
    return extractArticle(args);
  } catch (err) {
    // Never throw across the wire; surface a structured error result.
    logger.error(
      `extract failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return toErrorResult(err);
  }
}

export function registerExtractTool(server: McpServer): void {
  server.registerTool(
    'extract',
    {
      description: EXTRACT_TOOL_DESCRIPTION,
      inputSchema: extractInputShape,
      outputSchema: outputSchemaShape,
    },
    extractHandler,
  );
}
