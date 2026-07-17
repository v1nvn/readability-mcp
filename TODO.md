# TODO — readability-mcp enhancement backlog

> Scope: everything **after** the v1 POC (Phases 0–4).
> This file is the curated backlog of new tools, pipeline stages, output fields, and ops work — plus the ideas we explicitly rejected and why.
> Owner: vineet · Last reviewed: 2026-07-17

The guiding boundary (don't break it): **this server is an adapter between a renderer (chrome-devtools) and an extractor (Readability/Turndown) — deterministic, no outbound requests, no embedded LLM.** Features that cross the line use an existing abstraction (host `sampling`, chrome-devtools driving) instead of being built here.

**Priority thesis (the 2026-07-17 realignment):** the server is judged by the quality of `extract`, not by how many tools it exposes. The cheap `Now` correctness wins and the dev-loop infra shipped; the backlog now leads with *make `extract` measurably better* — benchmark first, then improve recall (richer round-trips), then precision (benchmark-guarded trim). New tools, ops, and packaging stay tracked but sit behind the quality work. Themes below are *topical grouping only*; the authoritative ordering is "Recommended sequencing."

**Tool-vs-option rule:** a new tool is justified only when it *skips a pipeline stage* (`outline`, `extract_metadata` skip Readability) or returns a fundamentally different shape (`extract_list` is a second engine). Alternate views of the full pipeline — images, structured data, tables, code — are **output options or metadata fields on `extract`**, not separate tools. Small MCP surface, increasingly capable pipeline.

---

## Legend

| Field | Meaning |
| --- | --- |
| **Tier** | `Now` = do first — cheap high-value capability + benchmark scaffold + safe real-web detections · `Next` = improve recall (richer round-trips), then precision (benchmark-guarded trim) · `Near` = shape output & convenience · `Future` = ambitious / second-engine / infra · `Stretch` = carried-forward / low priority · `Wontfix` = rejected (see Decisions) |
| **Effort** | `S` < 1 day · `M` 1–3 days · `L` > 3 days |
| **Lands at** | where in the architecture it goes (new tool / pipeline stage / policy module / output field / ops) |
| **Status** | `idea` · `scoped` · `in-progress` · `done` · `wontfix` |

Check a box when work starts; move the item to `done` (or `wontfix` with a reason) when resolved.

---

## Recommended sequencing

**v1.1 shipped:** the cheap correctness wins (QUAL-1 lazy images, QUAL-2 consent banners, QUAL-6 code language tags, QUAL-7 anchor absolutization), `outline` (TGT-1), token count (CTX-1), and the dev hot-reload loop (OPS-6). OPS-1 (worker isolation) is deferred by design — infra, not extract quality.

The backlog leads with `extract` quality and capability — and deliberately *not* with tool count. Alternate views of the pipeline ship as options/metadata on `extract` (see tool-vs-option rule).

**Now — cheap high-value + measure:**
1. **TGT-8 — `extract_metadata`** (S). Nearly free: `resolveMetadata` already runs with `readability` optional, so short-circuit before Readability and add `canonical`. Sits beside `outline` as a cheap pre-check.
2. **OBS-2a — Benchmark scaffold** (S/M). The keystone — every later content change becomes a measured delta. Scope includes size/token/fidelity metrics so we don't optimize extraction into 2× larger markdown.
3. **QUAL-3 / QUAL-4 — pagination + paywall detection** (M each). Safe diagnostics signals; zero extraction risk — can land in parallel with the scaffold.

**Next — improve recall before precision:**
4. **RICH-3 — Tables → CSV/JSON** (S). Shared matrix-IR serializer with TGT-5.
5. **RICH-2 — Footnote collection** (S). Preserves citation structure Readability flattens.
6. **TGT-4 — Structured data (JSON-LD/OG)** (M). A `metadata.structured` field on every `extract` result — `parseJsonLd` already runs in `resolveMetadata`, so this exposes work already done. No standalone tool.
7. **QUAL-5 — Boilerplate dedup** (M, OBS-2-gated). Subtractive and high-risk — done *after* the recall work, against a richer baseline, with the benchmark guarding recall.
8. **RICH-1 — Math → LaTeX** (L). Fiddly engine detection; dedicated fixtures.

**Near — shape output & convenience:**
- **CTX-2/3 — chunking** · **TGT-2 — `extract_links`** · **TGT-7 — `extract_section`** · **TGT-9 — images as an `extract` option** · **OPS-3 — CLI**.

**Explicitly deferred:**
- **TGT-3 — `extract_list` feed mode** (L). A second extraction engine; do not start until OBS-2 exists, or we can't tell if the heuristics help or hurt.
- **OPS-1 — worker isolation** (M). Infra; deferred pending a holistic worker-strategy decision (see item). The path-independent pieces (`timeout`/`maxNodes` + `TimeoutError → isError`) can still land early to bound input size.
- **OBS-2b (full harness), OBS-1, OBS-4 (trace), OPS-2/4/5, MCP-1/2, STR-1** — land after the quality waves, or when a specific need pulls them forward.

**Wontfix (low ROI — see Decisions):** TGT-6 `extract_code`, TGT-10 `normalize_html`.

---

## Theme A — More extraction targets

Readability only extracts "the article." Half the web isn't an article.

| ID | Title | Tier | Effort | Lands at |
| --- | --- | --- | --- | --- |
| TGT-1 | `outline` tool | Now | S | new tool |
| TGT-2 | `extract_links` tool | Near | S | new tool |
| TGT-3 | `extract_list` / feed mode | Near (OBS-2-gated) | L | new tool + policy |
| TGT-4 | Structured data (JSON-LD/OG) | Next | M | `metadata.structured` field on `extract` |
| TGT-5 | `extract_tables` tool | Near | M | new tool + output option |
| TGT-6 | `extract_code` tool | Wontfix | M | — |
| TGT-7 | `extract_section` tool | Near | S | new tool (resolver over `selectors.include`) |
| TGT-8 | `extract_metadata` tool | Now | S | new tool (short-circuit before Readability) |
| TGT-9 | Image inventory | Near | S | output option on `extract` (shared with QUAL-1) |
| TGT-10 | `normalize_html` mode | Wontfix | S | — |

### TGT-1 — `outline` tool  · `Now` · S
- [x] Implement
- **What:** Returns the document outline — headings (`h1`–`h6`) as a nested list, with anchor ids. No body content.
- **Why:** Cheap "is this worth reading?" / "where's the section about X?" pre-check before paying for full extraction. LLMs use it to navigate long docs.
- **Lands at:** New tool `outline({html, url?})`. Reuses `pipeline/dom.ts` + `normalize.ts`; no Readability/Turndown. Output: `structuredContent.outline = [{level, text, anchor}]`.
- **Acceptance:** Golden test on a docs fixture yields the expected heading tree; nested levels correct; anchors stable.

### TGT-2 — `extract_links` tool  · `Near` · S
- [ ] Implement
- **What:** Structured list of links: `{text, href (absolute), rel, isExternal}`.
- **Why:** Pairs with chrome-devtools for crawl/navigation decisions; lets the host pick the next page without re-parsing HTML.
- **Lands at:** New tool `extract_links({html, url?, sameOriginOnly?})`. Absolutization reuses `normalize.ts`. Output: `structuredContent.links = [...]`.
- **Acceptance:** Relative links absolutized against `url`; `rel="noopener/nofollow"` captured; dedup optional.

### TGT-3 — `extract_list` / feed mode  · `Near` · L
- [ ] Scope heuristics · [ ] Implement
- **What:** For index/search/blog-roll/HN-style pages, return `[{title, url, snippet, score}]` instead of one article.
- **Why:** Readability is article-only; this handles the other half of pages. Biggest "unlock" in the backlog.
- **Lands at:** New tool `extract_list({html, url?})` + a `policy/list-detector.ts` (detect repeated item structure — `<li>`/`<article>`/`<tr>` siblings with a link + text). Falls back to "not a list" signal in diagnostics.
- **Risks:** Heuristics are fuzzy; needs the benchmark (OBS-2) to validate. Start with a few known-good fixture shapes (HN, Google results, WP index).
- **Acceptance:** ≥80% item recall on `fixtures/{hn,search,blog-index}`; no false list-detection on article fixtures.

### TGT-4 — Structured data (JSON-LD/OG)  · `Next` · M
- [x] Implement
- **What:** Return the parsed JSON-LD/OG graph as `metadata.structured` on every `extract` result — `Article`/`Recipe`/`Product`/`Event`/`HowTo` when present, else `null`.
- **Why:** Readability is article-focused and loses structure. JSON-LD unlocks non-article content (recipes, products, events) as first-class data — and 95% of callers are served by it riding on `extract`; anyone wanting only the graph ignores the markdown.
- **Lands at:** A `metadata.structured` field on `extract`, populated by `policy/metadata.ts`. `parseJsonLd` + `pickArticleNode` **already run** in `resolveMetadata` (feeding scalars today) — extend the cascade to *return* the graph object(s), not just scalars. **No standalone tool** (tool-vs-option rule); the `extract_structured` tool is dropped.
- **Acceptance:** Recipe fixture → `{type:"Recipe", ingredients[], instructions[], cookTime…}`; product fixture → `{type:"Product", offers, rating}`; graceful `null` when absent.

### TGT-5 — `extract_tables` tool  · `Near` · M
- [ ] Implement
- **What:** Extract every `<table>` → GFM / CSV / JSON (caller picks), even from non-article pages.
- **Why:** Wikis/docs/data pages are table-heavy; Readability often drops or mangles them.
- **Lands at:** New tool `extract_tables({html, format:"gfm"|"csv"|"json"})`; also a `tables` output option on `extract`. Parse every `<table>` into one **normalized matrix IR** (resolving `rowspan`/`colspan`), then render all three formats from that IR — **including GFM**, not Turndown's native table rule, so degenerate cells round-trip consistently. Shared serializer with RICH-3.
- **Acceptance:** Round-trips a table with `rowspan/colspan` (document degenerate-cell handling); CSV quoted correctly.

### TGT-6 — `extract_code` tool  · `Wontfix` · M
- [x] Wontfix (low ROI)
- **Decision:** Code already rides in the extracted markdown — QUAL-6 canonicalizes language tags so fenced blocks carry their language. A separate tool returning *only* code is API surface for a niche (SO scraping) the main path already covers. Dropped; revisit only if a concrete need appears.

### TGT-7 — `extract_section` tool  · `Near` · S
- [ ] Implement
- **What:** Return only one section of a document, selected by CSS selector **or** by heading text (`extract_section({html, url?, selector?, heading?})`).
- **Why:** "Give me just the Authentication section" on a long doc, without paying for full extraction.
- **Lands at:** A **thin resolver over the existing `selectors.include` path** (`extract.ts`), not a new extractor. Selector mode calls straight through; heading mode uses the outline (TGT-1) to map the heading to its subtree, then scopes `include` to it. No parallel extraction logic.
- **Acceptance:** Heading `"Authentication"` returns only that section's markdown on a docs fixture; equivalent to `selector:"#auth"`; the section ends at the next same-or-higher-level heading.

### TGT-8 — `extract_metadata` tool  · `Now` · S  ⚡ cheap — beside `outline`
- [x] Implement
- **What:** Return only the metadata object — `title, byline, siteName, lang, publishedTime, excerpt, canonical, url` — no markdown.
- **Why:** Callers often want just the bibliographic info; today they must run full extraction to get it.
- **Lands at:** Short-circuit the pipeline before Readability/Turndown and return `resolveMetadata` (`metadata.ts`) directly — `readability?` is already optional there, so this is mostly wiring. Adds one field: `canonical` (`<link rel="canonical">` → `og:url`), not in the cascade today.
- **Acceptance:** Docs fixture returns full metadata incl. resolved canonical; no markdown in the result; markedly faster than full extract.

### TGT-9 — Image inventory  · `Near` · S
- [ ] Implement
- **What:** Structured image list `[{src, alt, width, height, caption}]` (absolute URLs, no inline markdown) via `extract({ ..., imageInventory: true })`, emitted in `structuredContent.images`.
- **Why:** Crawl/RAG callers want the image inventory, not rendered `![]()`.
- **Lands at:** An **output option on `extract`**, not a tool (tool-vs-option rule). The existing `images` option already governs *inline* rendering, so this is a distinct flag. Reuses QUAL-1's lazy-resolution walker (one image-source walker, not two). `caption` from a preceding `<figcaption>`, else `alt`.
- **Acceptance:** SPA fixture lists real (resolved) sources with captions; lazy placeholders resolved, not emitted; dedup optional.

### TGT-10 — `normalize_html` mode  · `Wontfix` · S
- [x] Wontfix (out of scope)
- **Decision:** The server's product is Markdown; returning sanitized-but-complete HTML "to feed your own extractor" is a different product, and dedicated sanitizers (DOMPurify etc.) already do it. The sanitize stage stays internal. Dropped.

---

## Theme B — Shape output for LLM context

The audience is LLMs. Nobody serves this well.

| ID | Title | Tier | Effort | Lands at |
| --- | --- | --- | --- | --- |
| CTX-1 | Token count | Now | S | metadata field |
| CTX-2 | `chunk` option / tool | Near | M | option + tool |
| CTX-3 | Semantic chunking | Near | M | policy |

### CTX-1 — Token count  · `Now` · S
- [x] Implement
- **What:** Estimated token count alongside `wordCount`.
- **Why:** Hosts budget context in tokens, not words. Lets the caller decide whether to chunk or summarize before sending.
- **Lands at:** `policy/metadata.ts` and the `Metadata` type — next to `wordCount`, which is a metadata field today, not a diagnostics one. Estimator: char-based heuristic (`≈ chars/4`) — no WASM dep, no model pinning. The count is *advisory* (the host re-counts before sending), so a real tokenizer's accuracy isn't worth the cost; drift on code-heavy/non-English text is acceptable and documented. Expose `{ tokenEstimate, estimator: "chars/4" }`.
- **Acceptance:** Within ±10% of a real tokenizer on 3 fixtures (one prose, one code-heavy, one mixed); estimator name in output.

### CTX-2 — `chunk` option / tool  · `Near` · M
- [ ] Implement
- **What:** Split extracted markdown into token/char-bounded chunks with overlap; return `[{index, text, tokenCount, headingContext}]`.
- **Why:** Direct RAG/embedding win; the host gets ready-to-embed slices instead of re-splitting.
- **Lands at:** Option `chunk: {maxTokens, overlap, strategy:"char"|"semantic"}` on `extract`, **and** standalone `chunk_text` tool (operates on already-extracted text). New `policy/chunk.ts`. Default to `semantic` (CTX-3) once it lands.
- **Acceptance:** No chunk exceeds `maxTokens`; overlap respected; every chunk carries its section heading for context; totals reconcile.

### CTX-3 — Semantic chunking  · `Near` · M
- [ ] Implement
- **What:** Break on heading/section/list boundaries instead of mid-sentence; carry hierarchy context per chunk; never split a code block.
- **Why:** Semantic chunks embed/retrieve far better than char slices.
- **Lands at:** `policy/chunk.ts` `strategy:"semantic"`. Builds on the outline (TGT-1) structure. Respects the same "never inside a code fence" rule as `truncate.ts`.
- **Acceptance:** Chunks align to `h2`/`h3` boundaries on a docs fixture; a 50-line code block stays intact.

---

## Theme C — Extraction-quality wins

Concrete correctness/quality improvements; SPAs are the motivation.

| ID | Title | Tier | Effort | Lands at |
| --- | --- | --- | --- | --- |
| QUAL-1 | Lazy-load image resolution | Now | S | pipeline stage |
| QUAL-2 | Sticky / consent-banner stripping | Now | S | pipeline stage |
| QUAL-3 | Pagination / infinite-scroll detection | Now | M | diagnostics field |
| QUAL-4 | Paywall / ad-overlay detection | Now | M | diagnostics field |
| QUAL-5 | Boilerplate dedup | Next (OBS-2-gated) | M | pipeline stage |
| QUAL-6 | Code-block language tags on real markup | Now | M | pipeline stage |
| QUAL-7 | Anchor (`<a href>`) absolutization | Now | S | turndown rule |

### QUAL-1 — Lazy-load image resolution  · `Now` · S  ⚡ do first
- [x] Implement
- **What:** In normalize, resolve lazy-load placeholders to the real source before Turndown: `data-src`/`data-original`/`data-lazy-src`/`srcset`, IntersectionObserver-swapped `src`, and responsive-image containers (`<picture><source srcset>` — the real URL often lives on `<source>`, with `<img>` as a placeholder fallback).
- **Why:** SPAs routinely ship a 1×1 placeholder as `src`; without this, every image in the markdown is broken. Correctness bug dressed as a feature.
- **Lands at:** `pipeline/normalize.ts` — a `resolveLazyImages(doc)` step after URL absolutization. Precedence: `<source>`/`data-src` → `srcset` largest candidate → known `data-*` attrs → IntersectionObserver-swapped `src`. Count swaps in diagnostics. The resolver is shared with TGT-9 (`extract_images`) — one image-source walker, not two.
- **Acceptance:** SPA fixture: placeholder `src` replaced with real URL; `diagnostics.imagesResolved` populated.

### QUAL-2 — Sticky / consent-banner stripping  · `Now` · S
- [x] Implement
- **What:** Remove `position:fixed|sticky` chrome, cookie/consent/GDPR dialogs, and modal overlays before Readability scores.
- **Why:** These poison Readability's density math and leak into the article. Near-universal pain on EU sites.
- **Lands at:** `pipeline/normalize.ts` — remove nodes matching `[role="dialog"]`, common consent-banner selectors, and chrome overlays. Do **not** strip on `position:fixed|sticky` alone — that nukes legit fixed nav, sticky table headers, and back-to-top buttons. Require the conjunction of fixed/sticky **+ large viewport coverage + high z-index** (a true overlay), so navigation bars survive. Make it **tunable** (`cleanChrome: true` default) so it can be disabled when it over-strips.
- **Acceptance:** Consent-dialog fixture: banner gone from output; main content preserved; removals counted.

### QUAL-3 — Pagination / infinite-scroll detection  · `Now` · M
- [x] Implement
- **What:** Detect "Next page" links / numbered pagination / infinite-scroll sentinel; **report** `{type:"paginated"|"infinite", nextUrl?}`, never act.
- **Why:** SPAs split content across scrolls/pages; the host needs to know more exists so it can drive chrome-devtools to load it.
- **Lands at:** `policy/diagnostics.ts` field `pagination`. Respects the boundary: we *detect*, chrome-devtools *drives*.
- **Acceptance:** Paginated article fixture → `nextUrl` correct; infinite-scroll fixture → `type:"infinite"` + selector hint.

### QUAL-4 — Paywall / ad-overlay detection  · `Now` · M
- [x] Implement
- **What:** Heuristics for likely paywall/overlay gating (truncated body + "subscribe" CTA, obscured content) → flag in diagnostics.
- **Why:** Lets the host know the extraction may be partial *without* silently returning a short article as if complete.
- **Lands at:** `policy/diagnostics.ts` field `gated: {likely: boolean, reason}`.
- **Acceptance:** Soft-paywall fixture flagged; clean article not.

### QUAL-5 — Boilerplate dedup  · `Next (OBS-2-gated)` · M
- [ ] Implement
- **What:** Strip "related posts" / newsletter signup / "read next" blocks Readability sometimes retains.
- **Why:** Reduces noise / token cost — but it's subtractive and the easiest way to silently delete useful info, so it ships *after* the recall work (RICH / TGT-4) against a richer baseline, benchmark-guarded (improve recall before precision).
- **Lands at:** `pipeline/normalize.ts` post-Readability trim, or a `policy/trim.ts`. Careful: easy to over-strip — gate behind tests.
- **Acceptance:** Removed-block count in diagnostics; no content loss on article fixtures (benchmarked, OBS-2).

### QUAL-6 — Code-block language tags on real markup  · `Now` · M
- [x] Implement
- **What:** In normalize (before Readability), canonicalize real-world code-block conventions to `<pre><code class="language-X">` so the language survives Readability's class stripping and turndown emits a fenced block with the tag. Conventions to map: GitHub `<div class="highlight highlight-source-js"><pre><code>` (and `highlight-source-shell`, `-python`, …), React/sandpack `<pre class="sp-javascript">`, generic `lang-X` / `brush: X`.
- **Why:** On real GitHub READMEs and docs pages, `extract` emits bare ` ``` ` fences with no language — Readability strips non-preserved classes (`highlight-source-js`, `sp-javascript`) before turndown runs, and `classesToPreserve` matches only `language-*`/`hljs` via literal-string equality (`_cleanClasses`). Validated on `github.com/mozilla/readability` and `react.dev/learn/…`; `html_to_markdown` is unaffected (it skips Readability). Language tags are load-bearing for LLM context on docs/repo/SO pages.
- **Lands at:** `pipeline/normalize.ts` — a `canonicalizeCodeBlocks(doc)` step before the Readability clone. For each `<pre>`, scan its own + ancestor classes for a language hint and set `<code class="language-X">` (unwrap GitHub's `<div class="highlight">` wrapper). Survival through Readability still depends on `language-X` being in the literal `classesToPreserve` list, so extend that list with common tokens (`js`, `ts`, `javascript`, `typescript`, `shell`, `python`, `java`, …); exotic languages fall back to a bare fence. Convention-handling lives in normalize (one place), not scattered across turndown rules.
- **Acceptance:** Fixtures with GitHub `highlight-source-js`/`-shell` and React `sp-javascript` blocks → ` ```js ` / ` ```shell ` / ` ```javascript ` in the `extract` golden; a canonical `<pre><code class="language-ts">` still works; `html_to_markdown` output unchanged.

### QUAL-7 — Anchor absolutization on non-Readability paths  · `Now` · S
- [x] Implement
- **What:** Absolutize `<a href>` against `url` everywhere, mirroring the existing image-absolutize rule. Today `url` absolutizes `<img src>` (custom turndown rule) but not `<a href>`; the `extract` main path is masked because Readability pre-absolutizes anchors, but `html_to_markdown` and the `extract` fallback path emit relative anchors next to absolute images.
- **Why:** Cross-path contract consistency — a caller passing `url` expects every relative URL absolutized regardless of which path produced the markdown. Validated: `html_to_markdown` and fallback emit `[link](/rel)` alongside `![img](https://…)`.
- **Lands at:** `pipeline/turndown.ts` — mirror the `imageKeep` rule with an `anchorKeep` rule that runs `node.getAttribute('href')` through the same `absolutize()` helper already used for images. Runs on all three paths (turndown is shared).
- **Acceptance:** `html_to_markdown` and `extract`-fallback fixtures with relative `<a href>` → absolute hrefs, matching image behavior; `extract` main path unchanged.

---

## Theme D — Rich-content round-trips

Make non-prose content LLM-readable.

| ID | Title | Tier | Effort | Lands at |
| --- | --- | --- | --- | --- |
| RICH-1 | Math → LaTeX | Next | L | turndown rule |
| RICH-2 | Footnote collection | Next | S | turndown rule |
| RICH-3 | Tables → CSV/JSON option | Next | S | output option (shared with TGT-5) |

### RICH-1 — Math → LaTeX  · `Next` · L
- [ ] Implement
- **What:** Serialize KaTeX/MathJax-rendered math back to `$…$` / `$$…$$`.
- **Why:** Scientific/docs pages are garbage to an LLM without this; with it they're first-class.
- **Lands at:** Custom turndown rule. KaTeX exposes the original LaTeX in `data-*`/`<annotation>`; MathJax v3 in `data-latex`/`<script type="math/tex">`. Detect engine, extract source, emit fenced math.
- **Risks:** Engine/version detection is fiddly; needs dedicated fixtures (arXiv abstract, MDN math, docs sites).
- **Acceptance:** KaTeX + MathJax fixtures → correct inline/display LaTeX; fallback leaves a placeholder, never crashes.

### RICH-2 — Footnote collection  · `Next` · S
- [x] Implement
- **What:** Gather `<sup>`/footnote refs and link them inline ↔ definitions; append a footnotes section.
- **Why:** Preserves citation structure Readability flattens.
- **Lands at:** Turndown rule + post-process.
- **Acceptance:** Article-with-footnotes fixture → numbered refs resolve to a definitions list.

### RICH-3 — Tables → CSV/JSON option  · `Next` · S
- [x] Implement (shared serializer with TGT-5)
- **What:** `tables: "gfm"|"csv"|"json"` output option on `extract`.
- **Why:** Some callers want data, not rendered tables.
- **Lands at:** `output/format.ts` + the TGT-5 matrix-IR serializer.
- **Acceptance:** Same table renders correctly in all three.

---

## Theme E — Observability

Make extraction quality *measurable* and *debuggable*.

| ID | Title | Tier | Effort | Lands at |
| --- | --- | --- | --- | --- |
| OBS-1 | `explain` tool | Near | M | new tool |
| OBS-2 | Extraction-quality benchmark | Now | L | test infra |
| OBS-3 | Differential golden tests vs Readability versions | Future | M | CI |
| OBS-4 | Pipeline trace & timings (debug) | Near | S | diagnostics field |

### OBS-1 — `explain` tool  · `Near` · M
- [ ] Implement
- **What:** A diagnostics-heavy post-mortem: Readability's scored candidate nodes (top-N with scores), the chosen root, a rendered "what Readability saw" HTML snapshot, and a breakdown of removed nodes by category.
- **Why:** The debugging superpower for tuning extraction and for trusting output. Extends the diagnostics object into a full report.
- **Lands at:** New tool `explain({html, url?, selectors?})`. Requires Readability `debug:true` + capturing its candidate scoring; may need a thin fork/wrapper to surface scores.
- **Acceptance:** On a mis-extracted fixture, `explain` shows *why* the wrong node won.

### OBS-2 — Extraction-quality benchmark  · `Now` · L  ⚡ keystone — land first
- [x] Scaffold (OBS-2a) · [ ] Full harness (OBS-2b)
- **What:** Across the fixture taxonomy, measure both *correctness* (precision/recall of the extracted main-content boundary vs human-labeled regions) **and *fidelity/cost*** — so optimizing extraction can't silently balloon the output. Report per fixture: markdown chars, estimated tokens, compression ratio (input nodes → output chars), nodes removed, and counts of preserved images/tables/links. Ship in two phases: **(a) scaffold** — label the *existing* fixtures and emit a per-PR content-delta + metric report (S/M); **(b) full harness** — precision/recall + aggregate scoring (the L).
- **Why:** This is how you *prove* an option (e.g. `extraction:"aggressive"`, QUAL-2) actually helps instead of guessing, and catch the failure mode where "better extraction" quietly produces 2× larger markdown. Required to ship TGT-3 and QUAL-5 confidently — so the scaffold lands first; every heuristic after that becomes measurable instead of guessed.
- **Lands at:** `test/bench/` — labeled fixtures + a metrics script run in CI on a dedicated job (not blocking PRs unless regression). Per-stage timings come from OBS-4.
- **Acceptance:** (a) a PR that touches extraction shows a readable content delta + the size/token/fidelity metrics per fixture; (b) reports per-fixture and aggregate precision/recall.

### OBS-3 — Differential golden tests vs Readability versions  · `Future` · M
- [ ] Implement
- **What:** Run the golden suite against multiple `@mozilla/readability` versions; flag behavior drift before bumping.
- **Why:** Readability ships scoring changes; pin/upgrade deliberately.
- **Lands at:** CI matrix job.
- **Acceptance:** A Readability bump produces a readable diff of affected fixtures.

### OBS-4 — Pipeline trace & timings  · `Near` · S
- [ ] Implement
- **What:** Per-stage timings (`normalize`, `stripConsent`, `absolutize`, `readability`, `turndown`, `metadata`) and the ordered stage list, surfaced in `diagnostics.trace` only under a debug flag.
- **Why:** Not for end-users — for future-us. When someone reports "this page is slow" or a benchmark regresses, the trace pinpoints the stage. Cheap to instrument (wrap each stage in `performance.now()`); OBS-2 consumes the same timings.
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
| OPS-6 | In-process dev hot reload (Vite SSR runner) | Done | S | dev tooling |

### OPS-1 — Worker-isolated jsdom + wall-clock timeout  · `Future` · M  (deferred — see note)
- [ ] Implement
- **What:** Run jsdom/Readability in a worker (or child process) with a wall-clock budget; `maxNodes` + `timeout` together bound worst-case cost.
- **Why:** Pathological/malicious HTML can hang or OOM jsdom; one bad page must not kill the server. Precondition before pointing this at arbitrary web.
- **Lands at:** `pipeline/dom.ts` wraps execution in a worker pool; `timeout` tool option (default e.g. 10s) + `errors.ts` maps timeouts to `isError`.
- **Acceptance:** A 50MB fixture or selector-bomb page returns `isError:timeout` within budget, server stays up.
- **Deferred — design fork vs OPS-6 (2026-07-17), not wontfix.** The literal spec (a worker pool inside `pipeline/dom.ts` that also survives the dev reload loop) has no clean implementation. OPS-6's dev loop runs the pipeline through Vite's in-process SSR module runner (`createServerModuleRunner`), so pipeline modules exist only as in-memory transformed entries in `runner.evaluatedModules` — `worker_threads` (which loads JS by filesystem path via Node module resolution) cannot import them, and Vite documents that the standard `new Worker(new URL(..., import.meta.url))` pattern "does not work with SSR" (Vite's first-class Worker support is browser Web Workers, not Node `worker_threads`; Node-native type-stripping doesn't rescue it because the source uses `.js`-extension imports resolved to `.ts`, which is a tsc/tsx convention the stripper doesn't remap). The wall-clock timeout genuinely requires a separate thread/process: jsdom's parse and Readability's DOM walk are synchronous and block the event loop, so no in-process `AbortSignal` can interrupt them. Options weighed: **(a)** `worker_threads` against a separately-bundled `dom-worker` entry (second SSR build target) with dev detecting no on-disk worker and falling back to in-process — ships real prod isolation (the actual threat model: arbitrary web in production), leaves the dev loop untouched; **(b)** child-process pool (`vite-node` child in dev, `node` child against `dist` in prod, JSON over stdio) — uniformly isolated but heavy (jsdom cold-start per slot) and reintroduces the cross-process RPC layer OPS-6 explicitly rejected; **(c)** defer. Chose **(c)** pending a holistic worker-strategy decision (e.g. alongside OBS-1's debug/explain needs). When picked up, the path-independent pieces land first regardless of strategy: the `timeout`/`maxNodes` tool option and an `errors.ts` `TimeoutError → isError` mapping — they bound input size and surface errors cleanly but, without a worker, cannot wall-clock-interrupt the synchronous parse.

### OPS-2 — MCP `Resources` for cache  · `Near` · M
- [ ] Implement
- **What:** Cache extractions and expose them as addressable `resources://readability/page/{hash}` (read-back via `resources/list` + `resources/read`).
- **Why:** `Resources` is MCP's *idiomatic* primitive for addressable cached content — reuse it instead of inventing a cache API. Key by the **normalized** hash: collapse whitespace, strip `<script>`/nonce/CSP/generated ids/timestamps before hashing, so volatile re-renders still hit. Store **both** the normalized hash (the cache key) and the original hash alongside each entry — the original lets you diagnose cache misses (same page, different nonce, should-have-hit-but-didn't → normalizer bug) without re-hashing the input.
- **Lands at:** `src/resources.ts` + a small LRU/TTL store (in-memory for v1, pluggable).
- **Acceptance:** Same HTML twice → second call served from cache (diagnostics/cache hit); different nonce → still a hit.

### OPS-3 — CLI  · `Near` · S
- [ ] Implement
- **What:** `readability-mcp extract file.html [--format md|json|html] [--max-chars N] [--stdin]`. Reads from stdin when no file is given (so `cat page.html | readability-mcp extract` works); `--stdin` is an explicit no-op alias for discoverability.
- **Why:** Free DX for non-MCP use (scripts, one-offs); reuses the exact same pipeline.
- **Lands at:** `src/cli.ts` behind a `bin` entry (`readability-mcp` dispatches: no args = MCP server, `extract` = CLI).
- **Acceptance:** Pipes a saved SPA fixture to markdown on stdout; exit codes on error.

### OPS-4 — Streaming for very large docs  · `Future` · L
- [ ] Implement
- **What:** Stream chunked text content instead of one big `content[0].text` for huge pages.
- **Why:** Multi-MB articles blow up a single tool result.
- **Lands at:** MCP progress/streaming primitives. **Verify host support first** — not all clients handle streamed tool results; may stay server-side chunking via CTX-2 instead.
- **Acceptance:** A large fixture returns without a single multi-MB payload when the host supports it.

### OPS-5 — Smithery manifest + Dockerfile  · `Near` · S
- [ ] Implement
- **What:** `smithery.yaml` + `Dockerfile` for one-click install on the Smithery registry (emzimmer ships these).
- **Why:** Discoverability / install ergonomics.
- **Lands at:** repo root files.
- **Acceptance:** `smithery` dry-run builds; image runs the server.

### OPS-6 — In-process dev hot reload  · `Done` · S
- [x] Implement
- **What:** `npm run dev` reloads tool implementations on file change without restarting the process or dropping the MCP client connection. One long-lived `McpServer` + `StdioServerTransport` — connected exactly once, because the SDK makes a transport single-use (`StdioServerTransport.start()` throws on a second call, and `Protocol.connect()` calls it). On change, Vite's SSR module runner (`environments.ssr.runner`, `hmr:false`) re-imports `src/server.ts` after `evaluatedModules.clear()`; the previous tool handles are `.remove()`d and a fresh batch registered (the SDK auto-fires `tools/list_changed`). Reloads are serialized via a promise chain; a failed reload (syntax error) keeps the previously-serving tools. `vite-node`'s `ViteNodeServer`/`ViteNodeRunner` are deliberately **not** used — they're a redundant cross-process RPC layer over the same Vite transform/module graph the built-in runner already drives in-process.
- **Why:** Tighter dev loop than a process restart (no client re-`initialize` round-trip; the connection and any future in-process state survive). The transport-reuse design from the original plan was abandoned after source-checking the SDK lifecycle; the supported shape is swap-tool-registrations-on-one-server, not swap-the-server.
- **Lands at:** `src/dev.ts` (dev-only entry; never in `dist` — `vite build` entry is `src/index.ts`, prod path unchanged). `src/server.ts` split into `createMcpServer` + `registerTools` (returns handles). The inner Vite server runs `logLevel:'warn'` so its info-level `console.log` ("`page reload`") can't reach stdout and corrupt the MCP stream.
- **Acceptance:** Contract test (`test/server/registration.test.ts`) over a real `tools/list` round-trip; smoke-tested end-to-end over stdio JSON-RPC — clean edit reloads, a syntax error logs `[reload] failed` while old tools keep serving, restore reloads again, stdout stays clean.

---

## Theme G — MCP-idiomatic (use the protocol's own abstractions)

| ID | Title | Tier | Effort | Lands at |
| --- | --- | --- | --- | --- |
| MCP-1 | `Prompts` — read-URL recipe | Near | S | mcp prompts |
| MCP-2 | `sampling`-based features (summarize/Q&A via host) | Future | M | mcp sampling |

### MCP-1 — `Prompts` — read-URL recipe  · `Near` · S
- [ ] Implement
- **What:** Ship a `prompts/read_url` that choreographs chrome-devtools → extract: navigate → wait for network idle → scroll → `evaluate_script(outerHTML)` → `extract`. Returns the filled prompt for the host.
- **Why:** Documents the intended two-tool flow as a first-class, discoverable artifact instead of a README snippet.
- **Lands at:** `src/prompts.ts`; MCP `prompts/list` + `prompts/get`.
- **Acceptance:** Host can list/get the prompt; it references the correct tool names from §5.

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
| Crawling / "follow all links" | **Reject** | That's chrome-devtools' job — it owns the browser. We consume one page at a time. `extract_links` (TGT-2) *enables* crawling but doesn't drive it. |
| Server-side `fetch` of URLs (beyond STR-1) | **Reject** | Static-only fetch reproduces the reference server's empty-article-on-SPAs failure on the exact pages this server exists for, and adds an SSRF surface. |
| `diff_pages` tool | **Reject** | Diffing two markdown strings is a 3-line host operation; not worth a tool. |
| `extract_code` tool (TGT-6) | **Wontfix** | Code already rides in the markdown (QUAL-6 tags it); a code-only tool is surface for a niche the main path covers. |
| `normalize_html` mode (TGT-10) | **Wontfix** | The server produces Markdown; sanitized-HTML output is a different product with existing tools (DOMPurify). |
| Standalone `extract_structured` / `extract_images` tools | **Reject** (option/field on `extract` instead) | They're alternate views of one pipeline, not distinct capabilities — see tool-vs-option rule. |

---

## Fixture taxonomy

Referenced throughout (OBS-2 labels these; QUAL/RICH items prove against them) but defined once here. This is the long-term coverage map — every quality claim is measured against a fixture in this tree. One rendered-HTML fixture per row under `test/fixtures/`, hand-labeled with the expected main-content boundary where it matters.

**Article-like (core Readability path):**
- `articles/` — long-form prose, the baseline.
- `blogs/` — blog posts (sidebar/nav noise).
- `news/` — news articles (bylines, datelines, related-content blocks → QUAL-5).
- `documentation/` — docs sites (headings, code, nav).
- `api-reference/` — API docs (tables, param lists, code).
- `wikipedia/` — encyclopedic (citations, infoboxes, tables).
- `github/` — rendered READMEs (QUAL-6 code fences).

**Non-article (Readability's weak spot — TGT-3 territory):**
- `recipes/` · `products/` — JSON-LD/OG structured data (TGT-4).
- `forums/` · `stackoverflow/` · `hn/` · `search/` — list/feed/index pages.

**Rich content (RICH):**
- `tables/` (RICH-3 / TGT-5) · `math/` (RICH-1) · `footnotes/` (RICH-2).

**Quality edge cases (QUAL):**
- `paywalls/` (QUAL-4) · `consent/` (QUAL-2) · `pagination/` · `infinite-scroll/` (QUAL-3).

---

## Cross-cutting notes

- **Extract quality is the spine of the roadmap:** new tools and ops items are tracked, but the value is the quality of `extract`. Quality work (QUAL / RICH / OBS-2 / TGT-4) leads; tool-count and ops items follow.
- **Everything respects the boundary:** no item adds outbound I/O except STR-1 (opt-in). No item embeds an LLM except MCP-2 (via host `sampling`).
- **Diagnostics is the technical spine:** QUAL-3/4, OBS-1, OBS-4 (trace), and the cache-hit signal (OPS-2) all extend `structuredContent.diagnostics`. Keep that schema additive and versioned — carry both `diagnostics.schemaVersion` (the diagnostics shape) and `diagnostics.pipelineVersion` (a hash of the pipeline: `@mozilla/readability` + Turndown versions and the normalize/turndown rule set) so benchmark output can be correlated across releases. Token count (CTX-1) lives in `metadata` next to `wordCount`, not in diagnostics.
- **Compatibility contract:** new `metadata` and `diagnostics` fields are additive; existing fields are never renamed or removed outside a major version. Hosts can pin a schema version and depend on it.
- **Two things gate confidence in the fuzzier items:** OBS-2 (benchmark) must exist before TGT-3 (list detection) and QUAL-5 (dedup) ship, or we can't tell if they help or hurt.
- **Reuse before reinvention:** structured data (TGT-4) extends the existing metadata cascade (`parseJsonLd` already runs); chunking reuses the outline; `extract_section` resolves through the existing `selectors.include` path; the image inventory (TGT-9) shares QUAL-1's walker; `extract_metadata` is the metadata cascade short-circuited before Readability; cache uses MCP `Resources`; LLM features use `sampling`. No new first-class mechanisms where an MCP primitive or existing pipeline path already fits.
