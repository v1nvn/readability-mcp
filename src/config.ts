import pkg from '../package.json' with { type: 'json' };

export interface ServerConfig {
  readonly description: string;
  readonly instructions: string;
  readonly logLevel: LogLevel;
  readonly name: 'readability-mcp';
  readonly title: string;
  readonly version: string;
}

export type LogLevel = 'debug' | 'error' | 'info' | 'silent' | 'warn';

const VALID_LEVELS: readonly LogLevel[] = [
  'debug',
  'info',
  'warn',
  'error',
  'silent',
];

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: Number.MAX_SAFE_INTEGER,
};

const DEFAULT_LOG_LEVEL: LogLevel = 'info';

function resolveLogLevel(env: NodeJS.ProcessEnv): LogLevel {
  const raw = env.READABILITY_MCP_LOG_LEVEL;
  if (raw && (VALID_LEVELS as readonly string[]).includes(raw)) {
    return raw as LogLevel;
  }
  return DEFAULT_LOG_LEVEL;
}

const SERVER_TITLE = 'Readability MCP';

const SERVER_DESCRIPTION =
  'Turn already-rendered (post-JavaScript) HTML into clean, LLM-friendly Markdown plus metadata, via Mozilla Readability, Turndown, and DOMPurify. Makes no outbound requests — input is the rendered HTML, read from a file path (localPath) so the page bytes never enter the model context.';

const SERVER_INSTRUCTIONS = `Ten always-on tools, all fed a file path (localPath) holding already-rendered HTML (e.g. document.documentElement.outerHTML written to disk by a browser/devtools capture) — except \`chunk_text\`, which operates on already-extracted text. A sampling-gated \`summarize\` adds an eleventh when (and only when) the host advertises the MCP \`sampling\` capability. The server never fetches URLs.

- extract: main tool. Runs Readability to pull the article and returns Markdown + metadata + diagnostics. Use by default for article-like pages. Pass the \`chunk\` option to also emit token-bounded chunks for RAG/embedding.
- extract_links: return a structured list of anchor links ({text, href, rel, isExternal}) from the raw DOM — hrefs absolutized against baseUrl; pairs with chrome-devtools for crawl/navigation decisions.
- extract_list: second engine for feed/index/search/HN-style pages Readability cannot turn into one article. Returns {items:[{title,url,snippet,score}], diagnostics} — the same-shape sibling-anchor cluster with the most items wins. Reports \`detected:false\` on article pages.
- extract_metadata: return only the bibliographic metadata (title, byline, siteName, lang, publishedTime, excerpt, canonical, baseUrl) without running Readability — fast pre-check for crawlers/citation.
- extract_section: return one section by CSS selector OR heading text. Selector mode is a straight pass-through to extract’s selectors.include; heading mode spans the matched heading to the next same-or-higher level (case-insensitive, first match wins).
- extract_tables: extract every <table> on the page (page-wide walk → gfm/csv/json), reusing the same rowspan/colspan-aware matrix serializer as the \`tables\` option on \`extract\`. Captures tables outside the article body — nav, aside, boilerplate — that the \`tables\` option never sees.
- explain: post-mortem for an extraction — surfaces Readability’s REAL per-candidate contentScore values, the chosen root, a removed-nodes breakdown, gating/pagination signals, and the pre-Readability HTML snapshot. Same normalize + Readability path as \`extract\`, no fallback cascade/Turndown.
- html_to_markdown: convert an arbitrary HTML fragment to Markdown with NO Readability scoring (e.g. a snippet already isolated via devtools).
- outline: cheap heading pre-check (h1-h6 with stable anchor ids) before paying for full extraction.
- chunk_text: split already-extracted text into token-bounded chunks (each with index, tokenCount, and nearest preceding heading) for embedding/RAG.

Sampling-gated (listed only when the client advertises \`sampling\` on initialize):
- summarize: delegate to the HOST’s model via \`sampling/createMessage\` — input {text, maxTokens?}, typically the output of \`extract\`/\`html_to_markdown\`. The server embeds no model and calls no provider directly; the host picks the model and may prompt the user first.

Rounding out the surface:
- prompts/read_url({url}): returns the recipe choreographing chrome-devtools render → readability \`extract\` for a live URL (the host executes it).
- resources: \`extract({cache:true})\` caches results as addressable \`readability://page/{hash}\` Resources; \`diagnostics.cache = {hit, normalizedHash, originalHash}\`. Re-renders that differ only in nonce/CSP/generated-id collapse to the same key (normalized-hash keying).

The optional baseUrl is origin context only (absolutizes relative links); it is never fetched. Every tool returns MCP structured content (metadata, diagnostics) validated by an output schema, plus a readable payload in content[0].text. Failures surface as { isError: true } results, never thrown across the wire.`;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    name: 'readability-mcp',
    version: pkg.version,
    title: SERVER_TITLE,
    description: SERVER_DESCRIPTION,
    instructions: SERVER_INSTRUCTIONS,
    logLevel: resolveLogLevel(env),
  };
}

export function levelEnabled(
  config: ServerConfig,
  level: Exclude<LogLevel, 'silent'>,
): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[config.logLevel];
}
