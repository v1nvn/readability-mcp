import type { ToolHandle } from '../server.js';

import { toErrorResult } from '../errors.js';
import { logger } from '../logger.js';
import { buildDocument } from '../pipeline/dom.js';
import { applySelectors } from '../pipeline/normalize.js';
import { absolutize } from '../pipeline/urls.js';
import { readHtmlFile } from './html-source.js';
import { extractLinksOutputShape } from './output-schema.js';
import {
  type ExtractLinksFromHtmlInput,
  type ExtractLinksInput,
  extractLinksInputSchema,
  extractLinksInputShape,
} from './schemas.js';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export interface ExtractedLink {
  readonly href: string;
  readonly isExternal: boolean;
  readonly rel: string;
  readonly text: string;
}

const MAX_TEXT_LENGTH = 300;

function clipText(raw: string): string {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  return collapsed.length > MAX_TEXT_LENGTH
    ? `${collapsed.slice(0, MAX_TEXT_LENGTH)}…`
    : collapsed;
}

// Non-http(s) schemes (mailto/tel/javascript/data) have an opaque origin and
// would otherwise compare as "different" — treat them as non-external so the
// isExternal flag tracks real cross-origin navigation only.
function isWebOrigin(parsed: URL): boolean {
  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}

function resolveExternal(absolutizedHref: string, baseUrl: string): boolean {
  let parsedHref: URL;
  try {
    parsedHref = new URL(absolutizedHref);
  } catch {
    return false;
  }
  if (!isWebOrigin(parsedHref)) {
    return false;
  }
  try {
    return new URL(baseUrl).origin !== parsedHref.origin;
  } catch {
    return false;
  }
}

// Drop <script>/<template> for safety (templates never render, scripts carry no
// crawl value), but keep nav/footer/main — crawl-relevant links live there.
function pruneUnsafeRoots(document: Document): void {
  for (const el of document.querySelectorAll('script, template')) {
    el.remove();
  }
}

export function extractLinks(rawArgs: unknown): CallToolResult {
  const { localPath, ...rest } = extractLinksInputSchema.parse(rawArgs);
  return extractLinksFromHtml({ html: readHtmlFile(localPath), ...rest });
}

// Schema defaults for callers that pass only a subset of the knobs (sameOriginOnly).
const DEFAULTS: Omit<ExtractLinksInput, 'localPath'> =
  extractLinksInputSchema.parse({ localPath: '' });

export function extractLinksFromHtml(
  input: Readonly<ExtractLinksFromHtmlInput>,
): CallToolResult {
  const { html, baseUrl, sameOriginOnly, selectors } = {
    ...DEFAULTS,
    ...input,
  };

  const { document } = buildDocument(html, baseUrl);
  applySelectors(document, selectors);
  pruneUnsafeRoots(document);

  const links: ExtractedLink[] = [];
  for (const anchor of document.querySelectorAll('a')) {
    const rawHref = anchor.getAttribute('href');
    if (!rawHref) {
      continue;
    }
    const href = absolutize(rawHref, baseUrl);
    const isExternal = baseUrl ? resolveExternal(href, baseUrl) : false;
    if (sameOriginOnly && isExternal) {
      continue;
    }
    links.push({
      text: clipText(anchor.textContent),
      href,
      rel: anchor.getAttribute('rel') ?? '',
      isExternal,
    });
  }

  const content = renderLinksIndex(links);
  return {
    content: [{ text: content, type: 'text' }],
    structuredContent: {
      schemaVersion: 1,
      content,
      links,
      metadata: { baseUrl },
    },
  };
}

// One `- [text](href)` line per link; never blank so content[0].text is scannable.
function renderLinksIndex(links: readonly ExtractedLink[]): string {
  if (links.length === 0) {
    return '(no links found)';
  }
  return links
    .map(link => `- [${link.text || '(no text)'}](${link.href})`)
    .join('\n');
}

export const EXTRACT_LINKS_TOOL_DESCRIPTION = `Return a structured list of anchor links from already-rendered (post-JavaScript) HTML — \`[{text, href, rel, isExternal}]\` in document order, hrefs absolutized against \`baseUrl\`. No Readability scoring, Turndown, or sanitization — links are gathered from the raw parsed DOM so nav/footer/main links survive. Pairs with chrome-devtools for crawl/navigation decisions. The server fetches nothing: \`localPath\` is the only source, and \`baseUrl\` is origin context only (never fetched).`;

export function extractLinksHandler(args: unknown): CallToolResult {
  try {
    return extractLinks(args);
  } catch (err) {
    logger.error(
      `extract_links failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return toErrorResult(err);
  }
}

export function registerExtractLinksTool(server: McpServer): ToolHandle {
  return server.registerTool(
    'extract_links',
    {
      title: 'Extract anchor links',
      description: EXTRACT_LINKS_TOOL_DESCRIPTION,
      inputSchema: extractLinksInputShape,
      outputSchema: extractLinksOutputShape,
    },
    extractLinksHandler,
  );
}
