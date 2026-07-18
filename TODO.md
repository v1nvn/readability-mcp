# TODO — readability-mcp enhancement backlog

> Scope: everything **after** the v1 POC (Phases 0–4).
> This file is the curated backlog of *remaining* new tools, pipeline stages, output fields, and ops work — shipped items are dropped (they live in the README + goldens), rejected ideas stay in the Decisions log.
> Owner: vineet · Last reviewed: 2026-07-18

The guiding boundary (don't break it): **this server is an adapter between a renderer (chrome-devtools) and an extractor (Readability/Turndown) — deterministic, no outbound requests, no embedded LLM.** Features that cross the line use an existing abstraction (host `sampling`, chrome-devtools driving) instead of being built here.

**Priority thesis:** the server is judged by the quality of `extract`, not by how many tools it exposes. The cheap correctness wins and the recall/precision round-trips have shipped; what remains is the *measurement* backbone (benchmark harness) plus convenience tools, ops, and packaging. New tools stay behind the quality work.

**Tool-vs-option rule:** a new tool is justified only when it *skips a pipeline stage* (`outline`, `extract_metadata` skip Readability) or returns a fundamentally different shape (`extract_list` is a second engine). Alternate views of the full pipeline — images, structured data, tables, code — are **output options or metadata fields on `extract`**, not separate tools. Small MCP surface, increasingly capable pipeline.

---

## Shipped (do not re-add)

Documented in the README and locked by golden tests — listed here only so the sequencing below reads in context:

- **Tools:** `outline`, `extract_links`, `extract_metadata`, `chunk_text` (beside `extract` and `html_to_markdown`).
- **`extract` options/fields:** token estimate (`metadata.tokenEstimate`), structured data (`metadata.structured`), `chunk` (char + semantic), `tables` (gfm/csv/json).
- **Extraction quality:** lazy-image resolution, consent/chrome stripping, boilerplate dedup, code-block language tags, anchor absolutization.
- **Diagnostics:** pagination + gating (paywall) detection.
- **Rich content:** math → LaTeX, footnote collection.
- **Infra:** benchmark scaffold (`npm run bench`), in-process dev hot reload.

---

## Legend

| Field | Meaning |
| --- | --- |
| **Tier** | `Next` = do next · `Near` = shape output & convenience · `Future` = ambitious / second-engine / infra · `Stretch` = low priority · `Wontfix` = rejected (see Decisions) |
| **Effort** | `S` < 1 day · `M` 1–3 days · `L` > 3 days |
| **Lands at** | where in the architecture it goes (new tool / pipeline stage / policy module / output field / ops) |
| **Status** | `idea` · `scoped` · `in-progress` · `done` · `wontfix` |

Check a box when work starts; move the item to `done` (drop it from this file) or `wontfix` (record in Decisions) when resolved.

---

## Recommended sequencing

The recall/precision round-trips shipped; the measurement backbone did not. Lead with it.

**Next — measure, then unlock the fuzzy items:**
1. **OBS-2b — Full benchmark harness** (L). The scaffold + metrics report shipped; the precision/recall scorer against human-labeled boundaries did not. This is the gate on `extract_list` (TGT-3) — without it we can't tell if list heuristics help or hurt.

**Near — shape output & convenience:**
- **TGT-7 — `extract_section`** · **TGT-9 — image inventory option** · **TGT-5 — `extract_tables` (standalone tool; the `tables` *option* already shipped)** · **OPS-3 — CLI** · **OBS-4 — pipeline trace** · **OBS-1 — `explain` tool** · **OPS-2 — MCP `Resources` cache** · **MCP-1 — `Prompts` read-URL recipe**.

**Future / deferred:**
- **TGT-3 — `extract_list` feed mode** (L, OBS-2b-gated). A second extraction engine; do not start until the full harness exists.
- **OPS-1 — worker isolation** (M). Infra; deferred pending a holistic worker-strategy decision (see item). The path-independent pieces (`timeout`/`maxNodes` + `TimeoutError → isError`) can land early to bound input size.
- **OBS-3, OPS-4/5, MCP-2, STR-1** — land when a specific need pulls them forward.

**Wontfix (see Decisions):** TGT-6 `extract_code`, TGT-10 `normalize_html`.

---

## Theme A — More extraction targets

Readability only extracts "the article." Half the web isn't an article.

| ID | Title | Tier | Effort | Lands at |
| --- | --- | --- | --- | --- |
| TGT-3 | `extract_list` / feed mode | Future (OBS-2b-gated) | L | new tool + policy |
| TGT-5 | `extract_tables` standalone tool | Near | M | new tool (option shipped) |
| TGT-7 | `extract_section` tool | Near | S | new tool (resolver over `selectors.include`) |
| TGT-9 | Image inventory | Near | S | output option on `extract` |

### TGT-3 — `extract_list` / feed mode  · `Future` · L
- [ ] Scope heuristics · [ ] Implement
- **What:** For index/search/blog-roll/HN-style pages, return `[{title, url, snippet, score}]` instead of one article.
- **Why:** Readability is article-only; this handles the other half of pages. Biggest "unlock" in the backlog.
- **Lands at:** New tool `extract_list({html, url?})` + a `policy/list-detector.ts` (detect repeated item structure — `<li>`/`<article>`/`<tr>` siblings with a link + text). Falls back to "not a list" signal in diagnostics.
- **Risks:** Heuristics are fuzzy; needs the full benchmark (OBS-2b) to validate. Start with a few known-good fixture shapes (HN, Google results, WP index).
- **Acceptance:** ≥80% item recall on `fixtures/{hn,search,blog-index}`; no false list-detection on article fixtures.

### TGT-5 — `extract_tables` standalone tool  · `Near` · M
- [x] Implement
- **What:** Extract every `<table>` on the page → GFM / CSV / JSON (caller picks), even from non-article pages.
- **Why:** Wikis/docs/data pages are table-heavy; the `tables` *option* on `extract` only sees tables inside the scored article. A standalone tool captures all tables regardless of the article boundary.
- **Lands at:** New tool `extract_tables({html, format:"gfm"|"csv"|"json"})`, reusing the shipped `policy/tables.ts` matrix-IR serializer (rowspan/colspan-aware). No new rendering logic — only a page-wide `<table>` walk in front of the existing serializer.
- **Acceptance:** Round-trips a table with `rowspan/colspan` (document degenerate-cell handling); CSV quoted correctly; captures tables outside the article body.

### TGT-7 — `extract_section` tool  · `Near` · S
- [x] Implement
- **What:** Return only one section of a document, selected by CSS selector **or** by heading text (`extract_section({html, url?, selector?, heading?})`).
- **Why:** "Give me just the Authentication section" on a long doc, without paying for full extraction.
- **Lands at:** A **thin resolver over the existing `selectors.include` path** (`extract.ts`), not a new extractor. Selector mode calls straight through; heading mode uses the `outline` policy to map the heading to its subtree, then scopes `include` to it. No parallel extraction logic.
- **Acceptance:** Heading `"Authentication"` returns only that section's markdown on a docs fixture; equivalent to `selector:"#auth"`; the section ends at the next same-or-higher-level heading.

### TGT-9 — Image inventory  · `Near` · S
- [x] Implement
- **What:** Structured image list `[{src, alt, width, height, caption}]` (absolute URLs, no inline markdown) via `extract({ ..., imageInventory: true })`, emitted in `structuredContent.images`.
- **Why:** Crawl/RAG callers want the image inventory, not rendered `![]()`.
- **Lands at:** An **output option on `extract`**, not a tool (tool-vs-option rule). The existing `images` option governs *inline* rendering, so this is a distinct flag. Reuses the shipped lazy-resolution walker (one image-source walker, not two). `caption` from a preceding `<figcaption>`, else `alt`.
- **Acceptance:** SPA fixture lists real (resolved) sources with captions; lazy placeholders resolved, not emitted; dedup optional.

---

## Theme E — Observability

Make extraction quality *measurable* and *debuggable*.

| ID | Title | Tier | Effort | Lands at |
| --- | --- | --- | --- | --- |
| OBS-1 | `explain` tool | Near | M | new tool |
| OBS-2b | Full benchmark harness (precision/recall) | Next | L | test infra |
| OBS-3 | Differential golden tests vs Readability versions | Future | M | CI |
| OBS-4 | Pipeline trace & timings (debug) | Near | S | diagnostics field |

### OBS-1 — `explain` tool  · `Near` · M
- [x] Implement
- **What:** A diagnostics-heavy post-mortem: Readability's scored candidate nodes (top-N with scores), the chosen root, a rendered "what Readability saw" HTML snapshot, and a breakdown of removed nodes by category.
- **Why:** The debugging superpower for tuning extraction and for trusting output. Extends the diagnostics object into a full report.
- **Lands at:** New tool `explain({html, url?, selectors?})`. Requires Readability `debug:true` + capturing its candidate scoring; may need a thin fork/wrapper to surface scores.
- **Acceptance:** On a mis-extracted fixture, `explain` shows *why* the wrong node won.

### OBS-2b — Full benchmark harness  · `Next` · L  ⚡ keystone
- [x] Implement
- **What:** The scaffold shipped (labeled fixtures + per-PR content-delta + size/token/fidelity metrics via `npm run bench`). This is the remaining half: precision/recall of the extracted main-content boundary vs human-labeled regions, aggregate scoring across the fixture taxonomy.
- **Why:** This is how you *prove* an option actually helps instead of guessing — required to ship TGT-3 (list detection) confidently.
- **Lands at:** `test/bench/` — extends the shipped metrics script with boundary labels + a precision/recall scorer, run in CI on the dedicated (non-blocking) bench job. Per-stage timings come from OBS-4.
- **Acceptance:** Reports per-fixture and aggregate precision/recall against human-labeled boundaries.

### OBS-3 — Differential golden tests vs Readability versions  · `Future` · M
- [ ] Implement
- **What:** Run the golden suite against multiple `@mozilla/readability` versions; flag behavior drift before bumping.
- **Why:** Readability ships scoring changes; pin/upgrade deliberately.
- **Lands at:** CI matrix job.
- **Acceptance:** A Readability bump produces a readable diff of affected fixtures.

### OBS-4 — Pipeline trace & timings  · `Near` · S
- [x] Implement
- **What:** Per-stage timings (`normalize`, `stripConsent`, `absolutize`, `readability`, `turndown`, `metadata`) and the ordered stage list, surfaced in `diagnostics.trace` only under a debug flag.
- **Why:** Not for end-users — for future-us. When someone reports "this page is slow" or a benchmark regresses, the trace pinpoints the stage. Cheap to instrument (wrap each stage in `performance.now()`); OBS-2b consumes the same timings.
- **Lands at:** `policy/diagnostics.ts` adds an optional `trace: { stage, ms }[]`, emitted only under a `debug` option — not a tool.
- **Acceptance:** With the debug flag on, a slow fixture's diagnostics show per-stage ms summing to the total; absent otherwise.

---

## Theme F — Robustness / ops

| ID | Title | Tier | Effort | Lands at |
| --- | --- | --- | --- | --- |
| OPS-1 | Worker-isolated jsdom + wall-clock timeout | Future | M | ops |
| OPS-2 | MCP `Resources` for cache | Near | M | mcp resources |
| OPS-3 | CLI (`readability-mcp extract file.html`) | Near | S | cli |
| OPS-4 | Streaming for very large docs | Future | L | transport |
| OPS-5 | Smithery manifest + Dockerfile | Near | S | packaging |

### OPS-1 — Worker-isolated jsdom + wall-clock timeout  · `Future` · M  (deferred — see note)
- [ ] Implement
- **What:** Run jsdom/Readability in a worker (or child process) with a wall-clock budget; `maxNodes` + `timeout` together bound worst-case cost.
- **Why:** Pathological/malicious HTML can hang or OOM jsdom; one bad page must not kill the server. Precondition before pointing this at arbitrary web.
- **Lands at:** `pipeline/dom.ts` wraps execution in a worker pool; `timeout` tool option (default e.g. 10s) + `errors.ts` maps timeouts to `isError`.
- **Acceptance:** A 50MB fixture or selector-bomb page returns `isError:timeout` within budget, server stays up.
- **Deferred — design fork vs the dev hot-reload loop, not wontfix.** The literal spec (a worker pool inside `pipeline/dom.ts` that also survives the dev reload loop) has no clean implementation. The dev loop runs the pipeline through Vite's in-process SSR module runner (`createServerModuleRunner`), so pipeline modules exist only as in-memory transformed entries in `runner.evaluatedModules` — `worker_threads` (which loads JS by filesystem path via Node module resolution) cannot import them, and Vite documents that the standard `new Worker(new URL(..., import.meta.url))` pattern "does not work with SSR" (Vite's first-class Worker support is browser Web Workers, not Node `worker_threads`). The wall-clock timeout genuinely requires a separate thread/process: jsdom's parse and Readability's DOM walk are synchronous and block the event loop, so no in-process `AbortSignal` can interrupt them. Options weighed: **(a)** `worker_threads` against a separately-bundled `dom-worker` entry (second SSR build target) with dev detecting no on-disk worker and falling back to in-process — ships real prod isolation, leaves the dev loop untouched; **(b)** child-process pool (JSON over stdio) — uniformly isolated but heavy (jsdom cold-start per slot) and reintroduces a cross-process RPC layer the dev loop explicitly rejected; **(c)** defer. Chose **(c)** pending a holistic worker-strategy decision (e.g. alongside OBS-1's needs). When picked up, the path-independent pieces land first regardless of strategy: the `timeout`/`maxNodes` tool option and an `errors.ts` `TimeoutError → isError` mapping — they bound input size and surface errors cleanly but, without a worker, cannot wall-clock-interrupt the synchronous parse.

### OPS-2 — MCP `Resources` for cache  · `Near` · M
- [ ] Implement
- **What:** Cache extractions and expose them as addressable `resources://readability/page/{hash}` (read-back via `resources/list` + `resources/read`).
- **Why:** `Resources` is MCP's *idiomatic* primitive for addressable cached content — reuse it instead of inventing a cache API. Key by the **normalized** hash: collapse whitespace, strip `<script>`/nonce/CSP/generated ids/timestamps before hashing, so volatile re-renders still hit. Store **both** the normalized hash (the cache key) and the original hash alongside each entry — the original lets you diagnose cache misses (same page, different nonce, should-have-hit-but-didn't → normalizer bug) without re-hashing the input.
- **Lands at:** `src/resources.ts` + a small LRU/TTL store (in-memory for v1, pluggable).
- **Acceptance:** Same HTML twice → second call served from cache (diagnostics/cache hit); different nonce → still a hit.

### OPS-3 — CLI  · `Near` · S
- [x] Implement
- **What:** `readability-mcp extract file.html [--format md|json|html] [--max-chars N] [--stdin]`. Reads from stdin when no file is given (so `cat page.html | readability-mcp extract` works); `--stdin` is an explicit no-op alias for discoverability.
- **Why:** Free DX for non-MCP use (scripts, one-offs); reuses the exact same pipeline.
- **Lands at:** `src/cli.ts` behind a `bin` entry (`readability-mcp` dispatches: no args = MCP server, `extract` = CLI).
- **Acceptance:** Pipes a saved SPA fixture to markdown on stdout; exit codes on error.

### OPS-4 — Streaming for very large docs  · `Future` · L
- [ ] Implement
- **What:** Stream chunked text content instead of one big `content[0].text` for huge pages.
- **Why:** Multi-MB articles blow up a single tool result.
- **Lands at:** MCP progress/streaming primitives. **Verify host support first** — not all clients handle streamed tool results; may stay server-side chunking via the `chunk` option instead.
- **Acceptance:** A large fixture returns without a single multi-MB payload when the host supports it.

### OPS-5 — Smithery manifest + Dockerfile  · `Near` · S
- [ ] Implement
- **What:** `smithery.yaml` + `Dockerfile` for one-click install on the Smithery registry.
- **Why:** Discoverability / install ergonomics.
- **Lands at:** repo root files.
- **Acceptance:** `smithery` dry-run builds; image runs the server.

---

## Theme G — MCP-idiomatic (use the protocol's own abstractions)

| ID | Title | Tier | Effort | Lands at |
| --- | --- | --- | --- | --- |
| MCP-1 | `Prompts` — read-URL recipe | Near | S | mcp prompts |
| MCP-2 | `sampling`-based features (summarize/Q&A via host) | Future | M | mcp sampling |

### MCP-1 — `Prompts` — read-URL recipe  · `Near` · S
- [x] Implement
- **What:** Ship a `prompts/read_url` that choreographs chrome-devtools → extract: navigate → wait for network idle → scroll → `evaluate_script(outerHTML)` → `extract`. Returns the filled prompt for the host.
- **Why:** Documents the intended two-tool flow as a first-class, discoverable artifact instead of a README snippet.
- **Lands at:** `src/prompts.ts`; MCP `prompts/list` + `prompts/get`.
- **Acceptance:** Host can list/get the prompt; it references the correct tool names.

### MCP-2 — `sampling`-based features  · `Future` · M
- [ ] Implement
- **What:** Optional summarize / translate / Q&A implemented by requesting the **host's** model via `sampling/createMessage`, never an embedded model.
- **Why:** Enables LLM features without bloating the server or coupling to a provider.
- **Lands at:** `src/sampling.ts`. **Off by default**; only when a host advertises sampling capability.
- **Acceptance:** With a sampling-capable host, `summarize` returns a host-generated summary; without the capability, tool is unlisted.

---

## Stretch

| ID | Title | Tier | Effort | Lands at |
| --- | --- | --- | --- | --- |
| STR-1 | `extract_url({url, render:"js"})` via Puppeteer | Stretch/Future | L | new tool (+ optional dep) |

### STR-1 — `extract_url` with `render:"js"`  · Stretch · L
- [ ] Decide whether needed
- **What:** The *only* path that takes a URL as a source. Server-side render via Puppeteer/Playwright for callers without chrome-devtools.
- **Why:** Opt-in for the no-chrome-devtools audience; the server otherwise makes zero outbound requests.
- **Lands at:** Optional `peerDependency`/optional dep so the default install stays light. A static-`fetch` URL mode is deliberately **not** planned (see Decisions).
- **Acceptance:** Opt-in install works; default install has no Puppeteer dep.

---

## Decisions log — rejected ideas (and why)

Recorded so future-us doesn't re-litigate them.

| Idea | Verdict | Why |
| --- | --- | --- |
| Embedded summarize / translate / sentiment | **Reject** (build via MCP-2 `sampling` instead) | Puts a model in the server → bloat, provider coupling, duplicates the host. The host already does this better. |
| Crawling / "follow all links" | **Reject** | That's chrome-devtools' job — it owns the browser. We consume one page at a time. `extract_links` *enables* crawling but doesn't drive it. |
| Server-side `fetch` of URLs (beyond STR-1) | **Reject** | Static-only fetch reproduces the reference server's empty-article-on-SPAs failure on the exact pages this server exists for, and adds an SSRF surface. |
| `diff_pages` tool | **Reject** | Diffing two markdown strings is a 3-line host operation; not worth a tool. |
| `extract_code` tool (TGT-6) | **Wontfix** | Code already rides in the markdown (language tags shipped); a code-only tool is surface for a niche the main path covers. |
| `normalize_html` mode (TGT-10) | **Wontfix** | The server produces Markdown; sanitized-HTML output is a different product with existing tools (DOMPurify). |
| Standalone `extract_structured` / `extract_images` tools | **Reject** (option/field on `extract` instead) | They're alternate views of one pipeline, not distinct capabilities — see tool-vs-option rule. |

---

## Fixture taxonomy

Referenced throughout (OBS-2b labels these; remaining quality items prove against them) but defined once here. This is the long-term coverage map — every quality claim is measured against a fixture in this tree. One rendered-HTML fixture per row under `test/fixtures/`, hand-labeled with the expected main-content boundary where it matters.

**Article-like (core Readability path):**
- `articles/` — long-form prose, the baseline.
- `blogs/` — blog posts (sidebar/nav noise).
- `news/` — news articles (bylines, datelines, related-content blocks).
- `documentation/` — docs sites (headings, code, nav).
- `api-reference/` — API docs (tables, param lists, code).
- `wikipedia/` — encyclopedic (citations, infoboxes, tables).
- `github/` — rendered READMEs (code fences).

**Non-article (Readability's weak spot — TGT-3 territory):**
- `recipes/` · `products/` — JSON-LD/OG structured data.
- `forums/` · `stackoverflow/` · `hn/` · `search/` — list/feed/index pages.

**Rich content:**
- `tables/` (TGT-5) · `math/` · `footnotes/`.

**Quality edge cases:**
- `paywalls/` · `consent/` · `pagination/` · `infinite-scroll/`.

---

## Cross-cutting notes

- **Extract quality is the spine of the roadmap:** new tools and ops items are tracked, but the value is the quality of `extract`. Measurement (OBS-2b) leads; tool-count and ops items follow.
- **Everything respects the boundary:** no item adds outbound I/O except STR-1 (opt-in). No item embeds an LLM except MCP-2 (via host `sampling`).
- **Diagnostics is the technical spine:** OBS-1, OBS-4 (trace), and the cache-hit signal (OPS-2) all extend `structuredContent.diagnostics`. Keep that schema additive and versioned — carry both `diagnostics.schemaVersion` (the diagnostics shape) and `diagnostics.pipelineVersion` (a hash of the pipeline: `@mozilla/readability` + Turndown versions and the normalize/turndown rule set) so benchmark output can be correlated across releases.
- **Compatibility contract:** new `metadata` and `diagnostics` fields are additive; existing fields are never renamed or removed outside a major version. Hosts can pin a schema version and depend on it.
- **OBS-2b gates the fuzzy items:** the full benchmark must exist before TGT-3 (list detection) ships, or we can't tell if it helps or hurts.
- **Reuse before reinvention:** `extract_section` resolves through the existing `selectors.include` path; the image inventory (TGT-9) shares the shipped lazy-image walker; `extract_tables` (TGT-5) reuses the shipped matrix-IR serializer; cache uses MCP `Resources`; LLM features use `sampling`. No new first-class mechanisms where an MCP primitive or existing pipeline path already fits.
