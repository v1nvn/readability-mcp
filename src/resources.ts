// In-memory cache of extract results keyed by a volatility-normalized hash of
// the HTML plus an args fingerprint, exposed to clients as addressable MCP
// Resources (`readability://page/{hash}`). Re-renders that differ only in
// nonce/CSP/generated ids collapse to the same key; the original hash rides
// alongside each entry so a should-have-hit-but-didn't miss points at a
// normalizer bug rather than a genuinely different page.

import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createHash } from 'node:crypto';

import type { ToolHandle } from './server.js';
import type { ExtractInput } from './tools/schemas.js';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  ListResourcesResult,
  ReadResourceResult,
} from '@modelcontextprotocol/sdk/types.js';

const MAX_ENTRIES = 256;
const TTL_MS = 30 * 60 * 1000;
const RESOURCE_SCHEME = 'readability://page/';

interface CacheEntry {
  readonly argsFingerprint: string;
  readonly cacheKey: string;
  readonly contentText: string;
  readonly expiresAt: number;
  readonly normalizedHash: string;
  readonly originalHash: string;
  // Held opaquely: cloned on hit and returned as CallToolResult.structuredContent
  // without re-validation, so a wider element type than the strict output schema
  // (e.g. readonly trace arrays) is fine here.
  readonly structuredContent: unknown;
}

interface CacheLookup {
  readonly entry: CacheEntry;
  readonly normalizedHash: string;
  readonly originalHash: string;
}

const entries = new Map<string, CacheEntry>();

export function resetCache(): void {
  entries.clear();
}

function evictExpired(now: number): void {
  for (const [key, entry] of entries) {
    if (entry.expiresAt <= now) {
      entries.delete(key);
    }
  }
}

// Bounded LRU: Map preserves insertion order, so re-insert on access to surface
// recently-used entries to the end and drop the oldest when over capacity.
function touch(key: string, entry: CacheEntry): void {
  entries.delete(key);
  entries.set(key, entry);
}

function pruneToMax(): void {
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next();
    if (oldest.done) {
      break;
    }
    entries.delete(oldest.value);
  }
}

// --- Hashing ---------------------------------------------------------------

// Conservative volatility normalization — over-stripping collides distinct
// pages. Each rule targets a specific known-volatile source.
function normalizeForHash(html: string): string {
  let s = html;
  // Non-JSON-LD scripts carry CSP nonces, build hashes, A/B test buckets —
  // same page, different bytes on every render — so strip them. Preserve
  // <script type="application/ld+json">: structured metadata is content, so
  // a changed datePublished must bust the cache. Mirrors the extraction
  // normalizer in pipeline/normalize.ts.
  s = s.replace(
    /<script\b(?![^>]*type\s*=\s*["']application\/ld\+json["'])[^>]*>[\s\S]*?<\/script>/gi,
    '',
  );
  s = s.replace(
    /<script\b(?![^>]*type\s*=\s*["']application\/ld\+json["'])[^>]*\/?>/gi,
    '',
  );
  // CSP <meta http-equiv="Content-Security-Policy"> carries the per-response
  // nonce directive — strip the whole tag.
  s = s.replace(
    /<meta\b[^>]*http-equiv=["']?content-security-policy["']?[^>]*>/gi,
    '',
  );
  // Per-render nonce attributes on any tag (script, link, style, …).
  s = s.replace(/\snonce\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  // Build-tool generated attribute names: Vue `data-v-1a2b3c4d`,
  // CSS-modules `data-css-1a2b3c4d`, Svelte `data-svelte-1a2b3c4d`. The
  // value-part is optional — Vue's compiler emits the bare `data-v-<hash>`
  // form with no `="..."`.
  s = s.replace(
    /\sdata-(?:v|css|svelte|h)-[a-z0-9]{6,}(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/gi,
    '',
  );
  // React useId / RSC / Next.js generated ids: id=":R1:", ':r1:',
  // __next_internal_action_…, react internal identifiers.
  s = s.replace(
    /\sid\s*=\s*(":[A-Za-z0-9_-]+:"|':[A-Za-z0-9_-]+:'|__next_[A-Za-z0-9_-]+)/g,
    '',
  );
  s = s.replace(
    /\sid\s*=\s*("react[A-Z]_[A-Za-z0-9_]+"|'react[A-Z]_[A-Za-z0-9_]+')/gi,
    '',
  );
  // Whitespace runs and indentation differ by minifier/pretty-printer.
  s = s.replace(/\s+/g, ' ');
  return s.trim();
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function normalizedHashOf(html: string): string {
  return sha256(normalizeForHash(html));
}

export function originalHashOf(html: string): string {
  return sha256(html.trim());
}

// Output-affecting options participate in the fingerprint so the same page with
// format:'html' vs format:'markdown' does not collide. `url` absolutizes links
// in the output, so it must participate too.
function buildArgsFingerprint(args: ExtractInput): string {
  const sel = args.selectors
    ? {
        exclude: args.selectors.exclude ?? [],
        include: args.selectors.include ?? '',
      }
    : null;
  const chunk = args.chunk
    ? {
        maxTokens: args.chunk.maxTokens,
        overlap: args.chunk.overlap,
        strategy: args.chunk.strategy,
      }
    : null;
  const fp = {
    chunk,
    cleanChrome: args.cleanChrome,
    codeBlockStyle: args.codeBlockStyle,
    debug: args.debug,
    extraction: args.extraction,
    format: args.format,
    gfm: args.gfm,
    headingStyle: args.headingStyle,
    imageInventory: args.imageInventory,
    images: args.images,
    keepClasses: args.keepClasses,
    maxChars: args.maxChars ?? null,
    maxNodes: args.maxNodes ?? null,
    metadataMode: args.metadataMode,
    minArticleLength: args.minArticleLength ?? null,
    readabilityOverrides: args.readabilityOverrides ?? null,
    sanitize: args.sanitize,
    selectors: sel,
    tables: args.tables ?? null,
    url: args.url ?? null,
    wordsPerMinute: args.wordsPerMinute,
  };
  return JSON.stringify(fp);
}

function computeHashes(html: string): {
  normalizedHash: string;
  originalHash: string;
} {
  return {
    normalizedHash: normalizedHashOf(html),
    originalHash: originalHashOf(html),
  };
}

function combineKey(normalizedHash: string, argsFingerprint: string): string {
  return sha256(`${normalizedHash}:${argsFingerprint}`);
}

// --- Store API -------------------------------------------------------------

export function lookup(
  html: string,
  args: ExtractInput,
): CacheLookup | undefined {
  const now = Date.now();
  evictExpired(now);
  const { normalizedHash, originalHash } = computeHashes(html);
  const cacheKey = combineKey(normalizedHash, buildArgsFingerprint(args));
  const entry = entries.get(cacheKey);
  if (!entry || entry.expiresAt <= now) {
    if (entry) {
      entries.delete(cacheKey);
    }
    return undefined;
  }
  touch(cacheKey, entry);
  return { entry, normalizedHash, originalHash };
}

export function storeResult(
  html: string,
  args: ExtractInput,
  result: {
    contentText: string;
    structuredContent: unknown;
  },
): { normalizedHash: string; originalHash: string } {
  const now = Date.now();
  evictExpired(now);
  const { normalizedHash, originalHash } = computeHashes(html);
  const argsFingerprint = buildArgsFingerprint(args);
  const cacheKey = combineKey(normalizedHash, argsFingerprint);
  const entry: CacheEntry = {
    argsFingerprint,
    cacheKey,
    contentText: result.contentText,
    expiresAt: now + TTL_MS,
    normalizedHash,
    originalHash,
    structuredContent: result.structuredContent,
  };
  entries.set(cacheKey, entry);
  pruneToMax();
  return { normalizedHash, originalHash };
}

export function getEntryByHash(hash: string): CacheEntry | undefined {
  for (const entry of entries.values()) {
    if (entry.normalizedHash === hash || entry.cacheKey === hash) {
      return entry;
    }
  }
  return undefined;
}

export function listEntries(): readonly CacheEntry[] {
  const now = Date.now();
  evictExpired(now);
  return [...entries.values()];
}

// --- Resource registration -------------------------------------------------

// "page-cache" names the registered template; the readability:// URI scheme
// identifies the cache namespace and {hash} is the combined cache key.
const PAGE_CACHE_TEMPLATE = new ResourceTemplate('readability://page/{hash}', {
  // Dynamic set: the cache comes and goes, so we enumerate current entries.
  list: (): ListResourcesResult => ({
    resources: listEntries().map(entry => ({
      description: `Cached extract for normalized hash ${entry.normalizedHash.slice(0, 12)}…`,
      mimeType: 'text/markdown',
      name: entry.normalizedHash,
      uri: `${RESOURCE_SCHEME}${entry.cacheKey}`,
    })),
  }),
});

export function registerCacheResources(server: McpServer): ToolHandle {
  return server.registerResource(
    'page-cache',
    PAGE_CACHE_TEMPLATE,
    {
      title: 'Cached page extractions',
      description:
        'Addressable cache of `extract` results called with cache:true. Each entry is keyed by the volatility-normalized hash of the HTML plus the output options; the URI path segment is the combined cache key.',
      mimeType: 'text/markdown',
    },
    (uri, variables): ReadResourceResult => {
      const hash = String(variables.hash);
      const entry = getEntryByHash(hash);
      if (!entry) {
        return {
          contents: [
            {
              uri: uri.href,
              text: '',
            },
          ],
        };
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'text/markdown',
            text: entry.contentText,
          },
        ],
      };
    },
  );
}

export function registerResources(server: McpServer): ToolHandle[] {
  return [registerCacheResources(server)];
}
