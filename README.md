# readability-mcp

Turn **already-rendered HTML** (captured post-JavaScript from a browser or [chrome-devtools MCP](https://github.com/anthropic/claude-code-chrome-devtools)) into clean, LLM-friendly **Markdown + metadata**, using [Mozilla Readability](https://github.com/mozilla/readability), [Turndown](https://github.com/mixmark-io/turndown), and [DOMPurify](https://github.com/cure53/DOMPurify).

The key idea: **rendering and extraction are decoupled.** A real browser (chrome-devtools) owns rendering; this server only transforms the HTML it is handed. **The server makes no outbound requests** — there is no `fetch`, no SSRF surface. The optional `url` is *origin context only*, used to absolutize relative links; it is never fetched.

## Install

```bash
npm install readability-mcp
# or run on demand:
npx readability-mcp
```

Requires Node >= 22. Build from source:

```bash
git clone <repo> && cd readability-mcp
npm install
npm run build      # bundles to dist/index.js
node dist/index.js # starts the stdio MCP server
```

## The chrome-devtools handoff

The motivating flow is two hops — each tool does the one thing it is best at:

```js
// 1. In the chrome-devtools MCP, grab the RENDERED document (post-JS):
mcp__chrome-devtools__evaluate_script({
  function: () => document.documentElement.outerHTML,
});

// 2. Hand the returned HTML string to readability-mcp.
//    `url` is OPTIONAL context (origin for absolutizing relative links) — never fetched.
mcp__readability__extract({ html: "<that string>", url: pageUrl });
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

Both tools return MCP **structured content** (`schemaVersion`, `metadata`, `diagnostics`) validated by a zod `outputSchema`, plus a human/LLM-readable payload in `content[0].text`. Nothing throws across the wire — failures become `{ "isError": true }` results.

### `extract` — primary tool

Extracts the main article from rendered HTML and returns Markdown + metadata + diagnostics.

| Option | Default | Description |
| --- | --- | --- |
| `html` *(required)* | — | Rendered HTML (post-JS), e.g. `document.documentElement.outerHTML`. |
| `url` | — | Optional origin. **Never fetched**; used to absolutize relative links/images. |
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
| `sanitize` | `true` | Run DOMPurify on the article HTML. |
| `maxChars` | — | Truncate the payload at a block boundary — **never inside a fenced code block**. |
| `wordsPerMinute` | `200` | For `readingTimeMin`. |
| `keepClasses` | `false` | Retain all classes (default strips non-language classes). |
| `readabilityOverrides` | — | Escape hatch — passed verbatim to `new Readability(doc, …)`. Unstable. |

**Fallback.** If Readability's `parse()` returns no article (e.g. an app shell or image-only page), a selector cascade salvages the first usable root — `article` → `main` → `[role=main]` → largest text-dense block → `body` — and reports `diagnostics.fallbackUsed: true` with `extractedNode` naming the root that was used.

**Metadata cascade.** Each metadata field is resolved by priority: **JSON-LD → OpenGraph → Twitter → `<meta>`/`<time>` → Readability → `<title>`** (first non-empty value wins).

### `html_to_markdown` — fragment path

Converts an arbitrary HTML fragment to Markdown **without** Readability scoring (e.g. a snippet already isolated via chrome-devtools). Same Turndown + DOMPurify path; reports `fallbackUsed: true`, `extractedNode: "fragment"`. Shares the `format`, `gfm`, `headingStyle`, `codeBlockStyle`, `images`, `sanitize`, `maxChars`, `wordsPerMinute`, `selectors`, and `url` options. Metadata is minimal (`url`, `wordCount`, `readingTimeMin`, and a title from the fragment's first heading).

## Diagnostics

`structuredContent.diagnostics` exposes: `readerable`, `extractedNode`, `fallbackUsed`, `removedNodes` (element delta vs. the document), `sanitization.{scripts,iframes}` (counted across the **whole** pipeline), and `truncated`.

## Payload size (stdio) — DESIGN §11.1

A full rendered SPA can be several MB as a string, and MCP tool args travel over JSON-RPC on stdio. Mitigations:

- **Scoped capture (recommended)** — real pages are large (hundreds of KB of `outerHTML`), so capture only what you need rather than the whole document. Via chrome-devtools `evaluate_script`, grab `document.head.outerHTML` (for metadata) plus a content subtree such as `document.querySelector('article')?.outerHTML || document.querySelector('main')?.outerHTML`, and pass that to `extract` with `url`. `url` absolutizes relative links within whatever HTML is passed.
- **`selectors.include`** — scope to the article subtree, e.g. `"main"`, so only the relevant DOM is scored and serialized.
- **`maxChars`** — cap the returned payload; truncation lands at a block boundary and never splits a fenced code block.
- **`maxNodes`** — a hard cap on elements parsed (`Readability.maxElemsToParse`) for very large documents.

## Development

```bash
npm run typecheck   # tsc --noEmit
npm run build       # vite build -> dist/index.js
npm run lint        # eslint
npm test            # vitest run
npm run test:update-goldens   # UPDATE_GOLDENS=1 vitest run
```

## License

MIT
