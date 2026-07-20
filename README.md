# readability-mcp

Turn **already-rendered HTML** (captured post-JavaScript from a browser or [chrome-devtools MCP](https://github.com/anthropic/claude-code-chrome-devtools)) into clean, LLM-friendly **Markdown + metadata**, using [Mozilla Readability](https://github.com/mozilla/readability), [Turndown](https://github.com/mixmark-io/turndown), and [DOMPurify](https://github.com/cure53/DOMPurify).

The key idea: **rendering and extraction are decoupled.** A real browser (chrome-devtools) owns rendering; this server only transforms HTML it reads from a file. **The server makes no outbound requests** — there is no `fetch`, no SSRF surface. Every HTML-input tool takes a `localPath` (a file on disk), never an inline string, so a full rendered page never enters the model context. The optional `baseUrl` is *origin context only*, used to absolutize relative links; it is never fetched.

## Install

```bash
npm install readability-mcp
# or run on demand:
npx readability-mcp
```

Requires Node >= 22. Build from source:

```bash
git clone <repo> && cd readability-mcp
yarn install
yarn build         # bundles to dist/index.js
node dist/index.js # starts the stdio MCP server
```

### Docker / Smithery

A `Dockerfile` (multi-stage `node:22-bookworm-slim`, runs as non-root `node`) and a `smithery.yaml` (stdio runtime) are included for container and [Smithery](https://smithery.ai) deployment:

```bash
docker build -t readability-mcp .
docker run --rm -i readability-mcp            # stdio MCP server on stdin/stdout
docker run --rm -i readability-mcp extract --format md < page.html
```

The Smithery manifest pins the `stdio` startCommand (this server ships `StdioServerTransport` only — the HTTP container runtime cannot launch it) and surfaces `READABILITY_MCP_LOG_LEVEL` as the one config knob.

## The chrome-devtools handoff

The motivating flow is two hops — each tool does the one thing it is best at:

```js
// 1. In the chrome-devtools MCP, grab the RENDERED document (post-JS) and write
//    it to a file via evaluate_script's `filePath` arg (the model emits only a
//    path, never the page bytes):
mcp__chrome-devtools__evaluate_script({
  function: () => document.documentElement.outerHTML,
  filePath: "/tmp/page.html",
});

// 2. Point readability-mcp at that file.
//    `baseUrl` is OPTIONAL context (origin for absolutizing relative links) — never fetched.
mcp__readability__extract({ localPath: "/tmp/page.html", baseUrl: pageUrl });
```

This matters most for SPAs and JS-augmented pages, where the initial HTML is an empty `<div id="root">` and only the post-JS DOM has the content.

## MCP client config

Add to your MCP client config (Claude Code, Claude Desktop, etc.):

```jsonc
{
  "mcpServers": {
    "readability": {
      "command": "npx",
      "args": ["-y", "readability-mcp"]
    }
  }
}
```

## Tools

All ten always-on tools return MCP **structured content** (`schemaVersion` plus a tool-specific payload of `metadata` / `diagnostics` / `items` / …) validated by a zod `outputSchema`, plus a human/LLM-readable payload in `content[0].text`. A sampling-capable host also sees an eleventh — `summarize` — registered after the `initialize` handshake when the client advertises the MCP `sampling` capability. Nothing throws across the wire — failures become `{ "isError": true }` results. Every input and output field carries a description in the tool's JSON schema, so clients can introspect each option without reading these docs.

**`localPath` — the only HTML input.** Every HTML-input tool takes a `localPath` pointing at a file holding the already-rendered (post-JavaScript) HTML. The server reads the bytes itself, so the page never enters the model context — the model emits only a path string. The motivating hop is chrome-devtools → readability: `evaluate_script` writes `document.documentElement.outerHTML` to a file via its `filePath` arg, then the tool reads that path. Resolved relative to the server process working directory; prefer absolute paths so the chrome-devtools capture and this read agree on location.

### `extract` — primary tool

Extracts the main article from rendered HTML and returns Markdown + metadata + diagnostics.

| Option | Default | Description |
| --- | --- | --- |
| `localPath` *(required)* | — | Path to a file holding the rendered HTML (post-JS), e.g. `document.documentElement.outerHTML` written to disk by a browser/devtools capture. The server reads it so the page bytes never enter the model context. |
| `baseUrl` | — | Optional origin. **Never fetched**; used to absolutize relative links/images. |
| `format` | `markdown` | `markdown` \| `html` \| `text` \| `json`. `json` emits `{metadata, content, diagnostics}`. |
| `metadataMode` | `none` | `none` \| `yaml` \| `json` — prepend a metadata block to the markdown/text payload. |
| `extraction` | `balanced` | `balanced` \| `aggressive` \| `conservative` — maps to Readability's scorer knobs. |
| `selectors.include` | — | Restrict extraction to a subtree: `"main"`, `"article"`, `".post"`. |
| `selectors.exclude` | — | Strip boilerplate before Readability: `["nav", "footer", "[role=banner]"]`. |
| `maxNodes` | — | Perf/safety cap = Readability `maxElemsToParse`. |
| `minArticleLength` | — | Semantic alias for Readability `charThreshold`. |
| `gfm` | `true` | Tables, strikethrough, task lists. |
| `headingStyle` | `atx` | `atx` (`#`) \| `setext` (underlining). |
| `codeBlockStyle` | `fenced` | `fenced` (\`\`\`) \| `indented`. |
| `images` | `keep` | `keep` \| `drop` \| `src-only` (bare URL) \| `reference` (link-ref style). |
| `tables` | — | `gfm` (default, native) \| `csv` \| `json` — render `<table>` elements via a rowspan/colspan-aware matrix IR. `csv`/`json` emit fenced code blocks; `gfm` re-renders native tables so headerless and span-degenerate tables round-trip consistently. When unset, tables pass through Turndown's native rule. |
| `sanitize` | `true` | Run DOMPurify on the article HTML. |
| `maxChars` | — | Truncate the payload at a block boundary — **never inside a fenced code block**. |
| `wordsPerMinute` | `200` | For `readingTimeMin`. |
| `keepClasses` | `false` | Retain all classes (default strips non-language classes). |
| `readabilityOverrides` | — | Escape hatch — passed verbatim to `new Readability(doc, …)`. Unstable. |
| `chunk` | — | Split the extracted markdown into token-bounded chunks (RAG/embedding-ready). `{maxTokens, overlap?, strategy?}` (strategy defaults to `semantic`) — when set, `structuredContent.chunks` is an array of `{index, text, tokenCount, headingContext}`. Only applies to `format:"markdown" \| "text"`; HTML/JSON payloads carry no markdown body to slice and leave `chunks` unset. |
| `imageInventory` | `false` | Emit `structuredContent.images` — an array of `{src, alt, width?, height?, caption}` for every `<img>` in the extracted article (absolute resolved srcs, placeholders skipped, caption from the enclosing `<figure>`'s `<figcaption>` else `alt`). Independent of the `images` inline-rendering option. |
| `debug` | `false` | Emit `diagnostics.trace` with per-stage `{stage, ms}` timings (`normalize`, `readability`, `sanitize`, `turndown`, `metadata`). Debug-only — `trace` is absent otherwise. |

**Fallback.** If Readability's `parse()` returns no article (e.g. an app shell or image-only page), a selector cascade salvages the first usable root — `article` → `main` → `[role=main]` → largest text-dense block → `body` — and reports `diagnostics.fallbackUsed: true` with `extractedNode` naming the root that was used.

**Metadata cascade.** Each metadata field is resolved by priority: **JSON-LD → OpenGraph → Twitter → `<meta>`/`<time>` → Readability → `<title>`** (first non-empty value wins). When the page carries schema.org JSON-LD, `metadata.structured` exposes the parsed primary object (Recipe/Product/Event/HowTo/Article…) with `@context` stripped and `@type` normalized, so non-article content rides on `extract` without a separate tool. Alongside the bibliographic fields, `metadata` carries `wordCount`, `readingTimeMin`, and `tokenEstimate` (with `estimator: "chars/4"` naming the heuristic) — an advisory count for context budgeting; the host re-counts before sending, so a model-specific tokenizer isn't worth the weight.

### `html_to_markdown` — fragment path

Converts an arbitrary HTML fragment to Markdown **without** Readability scoring (e.g. a snippet already isolated via chrome-devtools). Same Turndown + DOMPurify path; reports `fallbackUsed: true`, `extractedNode: "fragment"`. Takes `localPath` plus the same `format`, `gfm`, `headingStyle`, `codeBlockStyle`, `images`, `tables`, `sanitize`, `maxChars`, `wordsPerMinute`, `selectors`, `baseUrl`, and `debug` options as `extract`. Metadata is minimal (`baseUrl`, `wordCount`, `readingTimeMin`, and a title from the fragment's first heading).

### `extract_section` — one section by selector or heading

Returns just one section of a document — "give me the Authentication section" on a long doc without paying for full extraction. A thin resolver over `extract`'s `selectors.include` path, not a new extractor: selector mode passes straight through, and heading mode wraps the matched subtree in `<section data-rdrm-section-scope>` before routing through the same `selectors.include` path.

| Option | Default | Description |
| --- | --- | --- |
| `localPath` *(required)* | — | Path to a file holding the rendered HTML (post-JS), e.g. `document.documentElement.outerHTML` written to disk by a browser/devtools capture. The server reads it so the page bytes never enter the model context. |
| `baseUrl` | — | Optional origin. **Never fetched**; used to absolutize relative links/images. |
| `selector` | — | CSS selector scoping extraction to one subtree; passed straight through as `selectors.include`. Provide exactly one of `selector`/`heading`. |
| `heading` | — | Heading text selecting one section; the section spans from this heading to the next same-or-higher-level heading. Case-insensitive; first exact match wins, falling back to the first substring contain. Provide exactly one of `selector`/`heading`. |

Output shape is the same as `extract` (`content`, `metadata`, `diagnostics`). Heading mode is equivalent to selector mode on the same subtree: `heading: "Authentication"` discovers the same boundary a wrapping `<section id="auth">…</section>` would expose via `selector: "#auth"`. A non-matching heading yields `{ "isError": true }` with `no heading matched: <query>`.

### `extract_tables` — every table on the page

Extracts **every** `<table>` on the page — a `querySelectorAll('table')` walk (page-wide by default; narrow it with `selectors.include`) in front of the same rowspan/colspan-aware matrix serializer used by the `tables` option on `extract`. Runs **no** Readability, Turndown, sanitization, or `normalizeDocument` chrome-stripping, so it captures tables outside the article body (nav, aside, footer, boilerplate) that the `tables` option on `extract` never sees — the motivating case is wiki/doc/data pages whose content is table-heavy but whose article boundary hides most of them.

| Option | Default | Description |
| --- | --- | --- |
| `localPath` *(required)* | — | Path to a file holding the rendered HTML (post-JS), e.g. `document.documentElement.outerHTML` written to disk by a browser/devtools capture. The server reads it so the page bytes never enter the model context. |
| `baseUrl` | — | Optional origin. **Never fetched**; carried through to `metadata.baseUrl`. |
| `format` | `gfm` | `gfm` (default, native GFM table with a delimiter row) \| `csv` (RFC-4180-ish, quoted fields) \| `json` (array of row objects keyed by the header row). |
| `selectors` | — | Same `include`/`exclude` shape as `extract`. Scope the walk: `include:"#shareholding"` returns only tables inside that subtree; `exclude:[".ads"]` drops matches anywhere on the page. |

Output shape: `structuredContent.tables = [{index, rows, cols, markdown}]` — one entry per non-empty table in document order, where `rows`/`cols` are the matrix dimensions after rowspan/colspan resolution and `markdown` is the table rendered in the requested format. All entries' `markdown` are joined by blank lines into `content[0].text` (`"(no tables found)"` when the page has none). `metadata = {baseUrl?, format, tableCount}`. Empty `<table>` elements (no rows) are skipped, so `index` is contiguous over the emitted tables. Nested `<table>`s are emitted as their own entries in document order (the matrix walk excludes nested tables from a parent's matrix; `querySelectorAll` then returns the nested table separately).

### `extract_list` — feed/index/search pages

A **second engine** for pages Readability cannot turn into one article: HN-style feeds, search-result pages, blog indexes, product grids. Strips `nav`/`header`/`footer`/`aside` + ARIA chrome roles first (the false-positive guard so an article's nav menu doesn't look like a 4-item feed), then finds the container whose direct children form a same-shape sibling cluster of **≥3** elements each carrying a navigation anchor — the cluster with the most items wins. Runs **no** Readability, Turndown, sanitization, or `normalizeDocument` chrome-stripping (the detector scores against the very chrome-bearing structure the article normalizer would discard). Returns `detected:false` on article pages.

| Option | Default | Description |
| --- | --- | --- |
| `localPath` *(required)* | — | Path to a file holding the rendered HTML (post-JS), e.g. `document.documentElement.outerHTML` written to disk by a browser/devtools capture. The server reads it so the page bytes never enter the model context. |
| `baseUrl` | — | Optional origin. **Never fetched**; used to absolutize item `href`s. |
| `selectors` | — | Same `include`/`exclude` shape as `extract`. `include` picks which list the detector scores against — note the detector is comparative ("the cluster with the most items wins"), so pre-scoping to one container subverts that comparison; treat it as an "I know which list I want" escape hatch. |

Output shape: `structuredContent = {schemaVersion, content, items, diagnostics, metadata}`. `items = [{title, url, snippet, score}]` in document order — `snippet` is the item's text teaser (empty when the cluster has no per-item text), `score` is the detector's internal ranking weight. `diagnostics = {detected, itemCount, containerSelector, itemTag, confidence, note}`: `detected:false` means no list structure was found (`itemCount:0`, empty `items`, and a `note` explaining why); `containerSelector`/`itemTag` name the winning cluster; `confidence` is a rough quality signal. `metadata = {baseUrl}`.

### `outline` — heading pre-check

Returns the document outline (`h1`–`h6` in document order with stable anchor ids) as a cheap "is this worth reading?" / "where's the section about X?" pre-check before paying for full extraction. Runs **no** Readability, Turndown, or sanitization — a pure heading walk over the normalized DOM.

| Option | Default | Description |
| --- | --- | --- |
| `localPath` *(required)* | — | Path to a file holding the rendered HTML (post-JS), e.g. `document.documentElement.outerHTML` written to disk by a browser/devtools capture. The server reads it so the page bytes never enter the model context. |
| `baseUrl` | — | Optional origin. **Never fetched**; carried through to `metadata.baseUrl`. |
| `selectors` | — | Same `include`/`exclude` shape as `extract`. `include:"main"` scopes the heading walk to that subtree, dropping nav/footer headings from the outline. |

Output shape: `structuredContent.outline = [{level, text, anchor}]` plus an indented-bullet TOC rendered into `content[0].text`, and `metadata = {title?, baseUrl?}` (`title` falls back from `<title>` to the first `<h1>`). Anchor precedence: the heading's own `id`, then a descendant permalink's `#fragment`, then a slug of the text (deduped `-1`, `-2`, … for generated slugs only — author ids are kept verbatim).

### `extract_links` — anchor inventory for crawl/navigation

Returns a structured list of anchor links — `[{text, href, rel, isExternal}]` in document order — gathered from the raw parsed DOM. Runs **no** Readability, Turndown, sanitization, or `normalizeDocument` chrome-stripping, so nav/footer/main links survive (the crawl-relevant ones). Pairs with chrome-devtools for crawl/navigation decisions: the host picks the next page without re-parsing HTML.

| Option | Default | Description |
| --- | --- | --- |
| `localPath` *(required)* | — | Path to a file holding the rendered HTML (post-JS), e.g. `document.documentElement.outerHTML` written to disk by a browser/devtools capture. The server reads it so the page bytes never enter the model context. |
| `baseUrl` | — | Optional origin. **Never fetched**; absolutizes relative `href`s and drives `isExternal`. |
| `sameOriginOnly` | `false` | Drop cross-origin links; keep same-origin, relative, fragment, and non-http(s) (`mailto`/`tel`/`javascript`) links. |
| `selectors` | — | Same `include`/`exclude` shape as `extract`. DOM-level scope (e.g. `include:"#peers"`) applied before the link walk; composes with `sameOriginOnly`'s semantic filter. |

Output shape: `structuredContent.links = [{text, href, rel, isExternal}]` plus a `- [text](href)` rendering in `content[0].text`. `href` is absolutized against `baseUrl` (unchanged when `baseUrl` is absent or the pair fails to parse). `isExternal` is `true` only when `baseUrl` is provided **and** the absolutized `href` parses to a different HTTP(S) origin — relative, fragment, same-origin, `mailto:`/`tel:`/`javascript:`, and malformed hrefs are all `false`. `rel` is the raw attribute value (`"noopener noreferrer"`, `"nofollow"`, …) or `""` when absent. Anchors with no `href` are skipped; the rest are kept in document order with **no deduplication**.

### `extract_metadata` — bibliographic pre-check

Returns only the bibliographic metadata — `title`, `byline`, `siteName`, `lang`, `publishedTime`, `excerpt`, `canonical`, `baseUrl` — without running Readability/Turndown, as a fast pre-check for crawlers and citation. Short-circuits the pipeline before the article body is scored; resolves the same metadata cascade as `extract` (JSON-LD → OpenGraph → Twitter → `<meta>`/`<time>` → `<title>`), plus `<link rel="canonical">` → `og:url` for `canonical`. The `baseUrl` field is the origin you passed in; `canonical` is the page's declared canonical — they often differ.

| Option | Default | Description |
| --- | --- | --- |
| `localPath` *(required)* | — | Path to a file holding the rendered HTML (post-JS), e.g. `document.documentElement.outerHTML` written to disk by a browser/devtools capture. The server reads it so the page bytes never enter the model context. |
| `baseUrl` | — | Optional origin. **Never fetched**; carried through to `metadata.baseUrl`. |

Output shape: `structuredContent.metadata = {title?, byline?, siteName?, lang?, publishedTime?, excerpt?, canonical?, baseUrl?}` plus a human-readable `key: value` rendering in `content[0].text`. Note: `wordCount`/`readingTimeMin`/`tokenEstimate` are **not** populated by this tool — they are meaningless without the extracted body.

### `explain` — extraction post-mortem

Post-mortem diagnostics for an `extract` call: surfaces **why** Readability picked what it picked. Runs the same normalize + Readability pipeline as `extract` (no fallback cascade, no Turndown, no DOMPurify) and reads Readability's real per-candidate `contentScore` values off the DOM expando Readability stamps during scoring. Reach for it when `extract` lands on the wrong root or strips content you expected — it shows the scored runners-up so you can tune `selectors`/`extraction`/`minArticleLength`.

| Option | Default | Description |
| --- | --- | --- |
| `localPath` *(required)* | — | Path to a file holding the rendered HTML (post-JS), e.g. `document.documentElement.outerHTML` written to disk by a browser/devtools capture. The server reads it so the page bytes never enter the model context. |
| `baseUrl` | — | Optional origin. **Never fetched**; used for pagination/gating detection only. |
| `selectors` | — | Same `include`/`exclude` shape as `extract` — applied at the normalize step so the diagnosis matches what `extract` would see. |
| `topN` | `5` | Maximum scored candidate nodes to return (highest first); 1–20. |

Output shape: `structuredContent = {schemaVersion, content, chosenRoot, candidates, readerable, parseSucceeded, fallbackUsed, gating, pagination, removedNodes, snapshot}`. `chosenRoot` is Readability's raw top pick (before parent-walking/only-child post-processing); `candidates` is the ranked list (capped at `topN`) where each entry carries `{tag, id, className, selector, score, textLength}` — `score` is Readability's actual `contentScore`, not a self-rolled heuristic, and `selector` is a CSS-ish hint, **not** a unique locator (the score lives on a JS expando invisible to CSS). `removedNodes = {total, chrome, boilerplate}`. `gating`/`pagination` mirror `extract`'s diagnostics (`null` when none). `snapshot = {html, truncated}` is the post-normalize, pre-Readability HTML — "what Readability saw" — capped at 4000 chars. `parseSucceeded:false` is the signal that `extract` would have hit its fallback cascade; `fallbackUsed` is always `false` here (explain never runs the cascade).

### `chunk_text` — chunk for RAG/embedding

Splits already-extracted text into token-bounded chunks, each carrying `index`, `text`, `tokenCount` (chars/4, same estimator as `metadata.tokenEstimate`), and `headingContext` (the heading hierarchy path in effect at the chunk's first unit — empty string when the chunk precedes any heading). Operates on any text — pair with `extract`'s `chunk` option when you want chunks inline with the extraction.

| Option | Default | Description |
| --- | --- | --- |
| `text` *(required)* | — | Already-extracted text to split (e.g. markdown from `extract`). No HTML parsing or Readability scoring — the input is chunked verbatim. |
| `maxTokens` | `500` | Per-chunk token budget. No chunk exceeds this; oversized blocks are split by line, then hard-split. |
| `overlap` | `0` | Tokens to overlap between consecutive chunks (`>=0`). The trailing overlapChars of chunk N becomes the leading context of chunk N+1. |
| `strategy` | `semantic` | Chunking strategy. `semantic` (default) breaks on heading/section boundaries and never splits a fenced code block (an oversized code block is emitted as its own chunk that may exceed the budget — the deliberate tradeoff for keeping fences intact); `char` is the greedy char-bounded fallback that may split a code block. |

Output shape: `structuredContent.chunks = [{index, text, tokenCount, headingContext}]` in order, plus a readable numbered index in `content[0].text`. Empty array when the input has no non-whitespace content.

### `summarize` — host-model summarization (sampling-gated)

Delegates summarization to the **host's** model via MCP `sampling/createMessage` — the server embeds no model and calls no provider directly. Only listed when the connected client advertises the `sampling` capability on `initialize` (registered after the handshake, so a non-sampling host never sees it on `tools/list`); otherwise invisible. The host picks the model and may prompt the user before each call (human-in-the-loop, per MCP). Hand it the output of `extract`/`extract_section`/`html_to_markdown`/`chunk_text` — or any markdown/text string.

| Option | Default | Description |
| --- | --- | --- |
| `text` *(required)* | — | Markdown or text to summarize. Passed through to the host model verbatim; the server does not parse or modify it. |
| `maxTokens` | `512` | Upper bound on the summary length in tokens, forwarded as `sampling/createMessage` `maxTokens`. The host chooses the actual length. |

Output shape: a single `content[0].text` entry holding the host's summary. No `structuredContent` — the server returns whatever the host model produces. A non-text response from the host (e.g. an image) surfaces as `{ "isError": true }`.

## Diagnostics

`structuredContent.diagnostics` exposes: `readerable`, `extractedNode`, `fallbackUsed`, `removedNodes` (element delta vs. the document), `chromeRemoved` and `imagesResolved` (pre-conversion cleanup counts), `boilerplateRemoved` (related-posts / newsletter-signup / read-next blocks stripped before conversion, footprint-guarded so article content is never deleted), `sanitization.{scripts,iframes}` (counted across the **whole** pipeline), `pagination` (`{type:"paginated"|"infinite", nextUrl?, selector?}` — detection only; the host drives loading, this server never fetches), `gated` (`{likely, reason}` — detection only; signals a likely paywall/metered gate so the host knows the extraction may be partial — this server never fetches or authenticates), `truncated`, and `trace` (per-stage `{stage, ms}` timings — **debug-only**, emitted only when `debug:true` is passed to `extract`/`html_to_markdown`; absent otherwise). Stages are non-overlapping and ordered: `normalize`, `readability`, `sanitize`, `turndown`, `metadata` on the article path (`html_to_markdown` omits `readability`); on the fallback path a single `fallback` stage covers sanitize + turndown so the timings still sum to the pipeline's wall-clock.

## Rich content

- **Code-block language tags.** Before Readability scores the document, real-world code-block conventions are canonicalized to `<pre><code class="language-X">` so the language survives Readability's class stripping and Turndown emits a tagged fence. Mapped conventions: GitHub `<div class="highlight highlight-source-js">` wrappers (`-shell`, `-python`, …), React/sandpack `<pre class="sp-javascript">`, and generic `lang-X` / `brush: X`. Common language tokens are added to Readability's `classesToPreserve` so ` ```js `/` ```shell ` land in the markdown instead of a bare fence; exotic languages fall back to an untagged fence. Automatic (no option); `html_to_markdown` is unaffected (it skips Readability).
- **Footnotes.** When an article pairs `<sup>` reference markers with a definitions list (`<ol class="footnotes">`, `<ol class="references">`, `[role="doc-endnotes"]`, or standalone `<li id="fn-…">`/`<li id="cite_note-…">`), both halves are auto-converted to Markdown footnote syntax — inline `[^N]` markers in place of the `<sup>` and an appended `[^N]: definition` block. The conversion is automatic (no option); when no footnote markup is detected, output is byte-identical to a plain turndown.
- **Math.** KaTeX (`<span class="katex">` with an `<annotation encoding="application/x-tex">`) and MathJax (`<script type="math/tex">` / `mode=display`) are auto-converted to `$…$` (inline) or `$$…$$` (display) LaTeX before turndown runs, so raw backslashes survive unescaped and the rendered spans never leak. The conversion is automatic (no option); when the source LaTeX is absent (a broken `.katex` with no annotation, an empty MathJax script), a `[?]` placeholder is emitted in its place — never a crash.

## Payload size (stdio)

A full rendered SPA can be several MB as a string, and MCP tool args travel over JSON-RPC on stdio. Mitigations:

- **Scoped capture (recommended)** — real pages are large (hundreds of KB of `outerHTML`), so capture only what you need rather than the whole document. Via chrome-devtools `evaluate_script` (with its `filePath` arg), write `document.head.outerHTML` (for metadata) plus a content subtree such as `document.querySelector('article')?.outerHTML || document.querySelector('main')?.outerHTML` to a file, then point `extract` at it via `localPath`. `baseUrl` absolutizes relative links within whatever HTML is passed.
- **`selectors.include`** — scope to the article subtree, e.g. `"main"`, so only the relevant DOM is scored and serialized.
- **`maxChars`** — cap the returned payload; truncation lands at a block boundary and never splits a fenced code block.
- **`maxNodes`** — a hard cap on elements parsed (`Readability.maxElemsToParse`) for very large documents.

## Prompts

The server exposes one MCP prompt:

- **`prompts/read_url({url})`** — returns the recipe that choreographs the canonical two-tool flow for reading a live URL: a browser tool (chrome-devtools) renders the page, writes `document.documentElement.outerHTML` to a file via `evaluate_script`'s `filePath` arg, then the readability `extract` tool reads that file via `localPath` and turns it into Markdown. The prompt's job is to fill the host in on the handoff (the readability server never fetches URLs); the host executes the steps. The `url` argument is carried into the recipe as `baseUrl` (origin context) for `extract`.

## Resources (page cache)

`extract({cache:true})` caches the result and exposes it as an addressable MCP Resource at `readability://page/{hash}`. Subsequent `extract` calls with the same HTML (modulo volatile bytes — see below) and the same output options hit the cache instead of re-running the pipeline. The cache is in-memory, bounded (256 entries, LRU), and TTL'd (30 min).

- **`diagnostics.cache = {hit, normalizedHash, originalHash}`** appears on every cached `extract` result: `hit:true`/`false`, plus both hashes. The `normalizedHash` is what the key is built from; `originalHash` is the SHA-256 of the raw HTML. A miss where `normalizedHash` matches an existing entry but the lookup still missed points at an args-fingerprint mismatch (different `format`/`selectors`/…) rather than a genuinely different page — useful when debugging "should have hit."
- **Normalized-hash keying.** Before hashing, the HTML is volatility-normalized: inline `<script>` blocks, CSP `<meta>` tags, per-render `nonce=` attributes, build-tool generated attribute names (`data-v-…`, `data-css-…`, `data-svelte-…`, `data-h-…`), and React/Next generated `id`s (`:R1:`, `:r1:`, `__next_…`, `reactX_…`) are stripped, and whitespace runs are collapsed. The same page re-rendered with a fresh CSP nonce or a different build hash collapses to the same key.
- **Listing and reading.** `resources/list` enumerates current cache entries (`readability://page/{cacheKey}`, `text/markdown`); `resources/read` on a `readability://page/{hash}` URI returns the cached markdown (empty body if the entry has expired or been evicted).

## CLI

`readability-mcp` also runs as a one-shot CLI for extracting from a local HTML file or stdin, with no MCP server in the loop:

```bash
readability-mcp extract [file.html] [--format md|json|html] [--max-chars N]
```

- `extract` is the only subcommand; everything after it is parsed as options. With no args at all (`readability-mcp`), the stdio MCP server starts instead.
- `file.html` is read from disk; when no file is given, HTML is read from **stdin**.
- `--format`: `md` (default, markdown) | `json` (the `structuredContent` object, pretty-printed) | `html` (the post-pipeline HTML). Internally `json` reuses the markdown pipeline and serializes the structured object on the way out.
- `--max-chars N` mirrors `extract`'s `maxChars` — truncate the payload at a block boundary, never inside a fenced code block.

```bash
curl -s https://example.com | readability-mcp extract --format md
readability-mcp extract page.html --format json --max-chars 20000
cat saved.html | readability-mcp extract
```

## Development

```bash
yarn typecheck   # tsc --noEmit
yarn build       # vite build -> dist/index.js
yarn lint        # eslint
yarn test        # vitest run
yarn test:update-goldens   # UPDATE_GOLDENS=1 vitest run
```

## Benchmark

`yarn bench` prints a per-fixture metrics table (input nodes, markdown chars, token estimate, compression ratio, removed nodes, and preserved images/tables/links) plus a unified content delta against committed baselines under `test/bench/baseline/`. It also prints a **precision/recall table** of the extracted main content vs human-labeled boundaries (`test/bench/labels.ts` — one CSS selector per fixture naming its article container), with a macro-average aggregate row, and an **aggregate per-stage timing breakdown** averaged from the `debug` trace across fixtures. The bench runs in CI as a **non-blocking** job (`continue-on-error: true`), so a regression is surfaced, not gating; `bench.test.ts` additionally fails `yarn test` if the committed metrics or scores drift out of sync.

```bash
yarn bench                # print metrics + content deltas + PR/timing tables
BENCH_UPDATE=1 yarn bench # refresh baselines (do deliberately, like UPDATE_GOLDENS)
```

Per-fixture fields: `inputNodes` (parsed element count), `markdownChars`/`tokens` (output size, chars/4), `compressionRatio` (output chars per input node), `removedNodes` (element delta across the pipeline), and `images`/`tables`/`links` (preserved content counts). PR fields: `precision` (fraction of extracted word tokens inside the labeled main content), `recall` (fraction of labeled tokens recovered), `f1` (harmonic mean), `extractedTokens`/`labeledTokens` (multiset sizes). Fixtures with no prose (the image-only `fallback` gallery) score N/A and are excluded from the aggregate.

## License

MIT
