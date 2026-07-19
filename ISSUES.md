# ISSUES — consolidated review findings

> Curated from two independent code reviews (2026-07-19). Every finding below was re-verified against current source before inclusion — file:line citations reflect the tree as of `main` at review time. Nothing here is a crash or a security hole; the suite is green (typecheck, lint, tests). These are correctness-adjacent behavior gaps, build/reproducibility drift, doc/schema drift, and hygiene items.
>
> Check a box when fixed. Confirm with `npm run typecheck && npm run lint:fix && npm test`, and for runtime-shaped changes also exercise the tool through the connected MCP server (`npm run dev`, wired in `.mcp.json`).

## Status

- [ ] open · [x] fixed · [~-] accepted / wontfix (reason recorded in the entry)

## Summary

| ID | Sev | Area | Title | Source |
| --- | --- | --- | --- | --- |
| [ISS-1](#iss-1-medium--npm-install-rationale-is-false-use-npm-ci) | medium | build/ops | Dockerfile + readability-versions.yml `npm install` rationale is false | R1#1 |
| [ISS-2](#iss-2-low--indextts-comment-misrepresents-the-dynamic-import) | low | code/docs | `index.ts` comment misrepresents the dynamic import | R1#2 |
| [ISS-3](#iss-3-low---stdin-is-dead-surface) | low | hygiene | `--stdin` is dead surface | R1#3 |
| [ISS-4](#iss-4-low--backtick-as-apostrophe-in-explain-schema-descriptions) | low | docs | Backtick-as-apostrophe in `explain` schema descriptions | R1#4 |
| [ISS-5](#iss-5-low--tautological-assertion-in-resourcestestts) | low | test | Tautological assertion in `resources.test.ts` | R1#5 |
| [ISS-6](#iss-6-low-medium--extract_list-schema--impl-disagree-title-url-snippet) | low-medium | behavior | `extract_list` schema & impl disagree (title, url, snippet) | R1#6, R2#2 |
| [ISS-7](#iss-7-low--readme-lead-over-generalizes-diagnostics) | low | docs | README lead over-generalizes "all ten tools return diagnostics" | R1#7 |
| [ISS-8](#iss-8-low--todomd-contradicts-itself-about-obs-2b) | low | docs | `TODO.md` contradicts itself about OBS-2b | R2#1 |
| [ISS-9](#iss-9-low-medium--truncatemarkdown-drops-all-content-when-the-first-block-exceeds-maxchars) | low-medium | behavior | `truncateMarkdown` drops all content when the first block exceeds `maxChars` | R2#3 |
| [ISS-10](#iss-10-low-medium--cache-normalizer-strips-json-ld-inconsistent-with-extraction) | low-medium | behavior | Cache normalizer strips JSON-LD, inconsistent with extraction | R2#4 |
| [ISS-11](#iss-11-informational--explain-snapshot-is-not-dompurify-sanitized) | informational | behavior | `explain` snapshot is not DOMPurify-sanitized (documented) | R2#5 |
| [ISS-12](#iss-12-low--extract_section-heading-mode-parses--normalizes-twice) | low | efficiency | `extract_section` heading mode parses + normalizes twice | R2#6 |
| [ISS-13](#iss-13-low--duplicated-helpers-headingtext-iselement) | low | hygiene | Duplicated helpers: `headingText`, `isElement` | R2#7 |
| [ISS-14](#iss-14-informational--accepted-devts-oninitialized-captures-first) | informational | hygiene | `dev.ts` `oninitialized` captures `first` (non-issue in practice) | R2#8 |

Suggested ordering for a fix session: ISS-1, ISS-6, ISS-9, ISS-10 (substance) → ISS-2/4/5/7/8 (cheap docs/test) → ISS-3/12/13 (hygiene) → ISS-11/14 (decide only).

---

## Behavior / correctness

### ISS-6 (low-medium) — `extract_list` schema & impl disagree (title, url, snippet)

Three fields on `listItemSchema` describe states the implementation never produces, and one field's behavior contradicts its doc. All three live in the same fix pass over `policy/list-detector.ts` (`extractItem`) + `tools/output-schema.ts` (`listItemSchema`).

- [x] **snippet echoes the title for title-only items.** `list-detector.ts:193-196` — when `fullText === title`, the `fullText.length > title.length` guard is false, so `snippet` falls through to `clipSnippet(fullText)` (the title again) instead of empty. The schema promises the opposite: *"Empty when the item is title-only"* (`output-schema.ts:534`). HN/search fixtures only assert `title`/`url`, so this is untested. **Fix:** in the else branch, peel to `''` (or set `snippet = ''` when `fullText === title`).
- [x] **`title` "falls back to the first heading text" never happens.** Schema (`output-schema.ts:539`) says title *"Falls back to the first heading text only when no anchor has text."* But `navigationAnchorsors` filters out empty-text anchors (`list-detector.ts:91`), and `extractItem` returns `null` when `title` is empty (`:181-183`) — there is no heading fallback. **Fix:** drop the fallback clause from the description.
- [x] **`url` "Empty when the anchor has no href" never happens.** Schema (`output-schema.ts:544`). Anchors without a navigation-worthy href are filtered (`isNavigationHref`, `:64-74`), and `extractItem` returns `null` when `url` is falsy (`:186-188`). Emitted `url` is always non-empty. **Fix:** drop the "Empty when…" clause.

### ISS-9 (low-medium) — `truncateMarkdown` drops all content when the first block exceeds `maxChars`

- [x] Fixed.

`policy/truncate.ts:22-42`. The loop breaks as soon as a block would overflow the budget measured from `start`. For the *first* block, `from = block.start` and the own-length check `block.end - from > maxChars` trips before `start` is ever set, so `start` stays `-1` and `kept = ''`. The payload becomes just `\n\n…[truncated]` — total content loss. A 5000-char opening paragraph with `maxChars: 1000` yields nothing.

- This is tested (`test/policy/truncate.test.ts:57-63`) but only to assert a sole oversized **code** block is excluded rather than split — not that content survives.
- It is asymmetric with `policy/chunk.ts`, which `hardSplitLines` an oversized non-code block instead of dropping it (`:66-93`, `:323-332`).
- **Decision needed:** either (a) hard-split an oversized first **non-code** block to match `chunk.ts` (keep the "never split a fence" guarantee for code), or (b) keep current behavior and document the "first block too large → empty" case explicitly in the `maxChars` schema description (`schemas.ts:115-122`). (a) is the less surprising choice.

### ISS-10 (low-medium) — Cache normalizer strips JSON-LD, inconsistent with extraction

`src/resources.ts:82-83` removes *all* `<script>` blocks including `<script type="application/ld+json">`, but the comment (`:80-81`) justifies script-stripping only for "CSP nonces, build hashes, A/B test buckets" — none of which live in ld+json.

- Two re-renders of the same page whose only difference is changed structured metadata (e.g. an updated `datePublished`) collapse to the same `normalizedHash` → cache hit → stale `metadata.structured` / `publishedTime`.
- It contradicts the **extraction** normalizer, which deliberately preserves ld+json (`pipeline/normalize.ts:27-30`: `script:not([type="application/ld+json"])`). The two normalizers disagree on the same input — a cross-layer contract mismatch.
- Narrow in practice (ld+json rarely changes between renders) but it is an over-normalization the comment disclaims.
- **Fix:** use `script:not([type="application/ld+json"])` in `normalizeForHash` to match the extraction path; update the comment.

### ISS-11 (informational) — `explain` snapshot is not DOMPurify-sanitized

`policy/explain.ts:139` snapshots `document.body.innerHTML` after `normalizeDocument` (which strips scripts/base/nonce but **not** inline event handlers — only DOMPurify does that, and `explain` intentionally skips it). So `snapshot.html` can carry `onerror=`/`onclick=` handlers.

- Already documented: `tools/explain.ts:182` — *"Not DOMPurify-sanitized; that runs on Readability's output in `extract`."*
- Low risk: it is truncated diagnostic data, not rendered output. A host that rendered `snapshot.html` verbatim would execute handlers — but that is an unusual thing to do with diagnostic data.
- **Action (optional):** the doc stance is defensible; if kept, consider strengthening the description to explicitly warn "may carry inline event handlers; do not render verbatim." No code change required if the stance is intentional. [~-] leaning accepted.

---

## Build / ops

### ISS-1 (medium) — `npm install` rationale is false; use `npm ci`

- [x] Fixed.

The `Dockerfile` (`:3-7`, `npm install` at `:11` and `:18`) and `.github/workflows/readability-versions.yml` (`:28-32`) both justify `npm install` over `npm ci` with: the lockfile *"is generated on darwin and omits linux-only optional build deps (`@rolldown/binding-linux-*` + `@emnapi/*`),"* so `npm ci`'s completeness check fails on linux. Verified the opposite:

- `package-lock.json` (v3) contains **full** entries for every `@rolldown/binding-linux-*` (`:734-849`) — each with `resolved` + `integrity` + `cpu` + `os:["linux"]` + `optional:true`, declared as `optionalDependencies` of `rolldown` (`:4803-4809`). `@emnapi/*` packages are not platform-optional at all.
- The project's own CI proves `npm ci` works on linux: `test.yml:20`, `bench.yml:21`, and `release.yml:44` all run `npm ci` on `ubuntu-latest`, and `test.yml` + `release.yml` then run `npm run build` (vite → rolldown, which needs exactly those linux bindings). If `npm ci` were broken on linux, that job would be red.

**Fix:** switch the `Dockerfile` build + runtime stages to `npm ci` / `npm ci --omit=dev` (restores build reproducibility — `npm install` resolves fresh versions each build) and delete the false comment. For `readability-versions.yml`, the initial bootstrap can be `npm ci` too; the subsequent `npm install "@mozilla/readability@<ver>"` steps legitimately stay as `npm install` (they swap a version in place) — but their comment's "darwin-only gaps" claim should be corrected regardless.

Caveat: I could not run `npm ci` inside a linux container locally, but the lockfile contents + three passing linux CI jobs make the evidence strong.

---

## Docs / schema / test

### ISS-2 (low) — `index.ts`'s comment misrepresents the dynamic import

`src/index.ts:6`: *"Dynamic import so the CLI path doesn't pull in the MCP server/transport modules."* But lines 1-4 statically `import` `McpServer`, `StdioServerTransport`, and `createServer` — hoisted and evaluated at module load — so `node dist/index.js extract` has already loaded them before reaching the `if`. The dynamic `import('./cli.js')` does not do what the comment says.

- **Fix (simplest):** drop the comment. Moving the SDK imports into the `else` branch would make the comment true but saves little (the CLI path pulls in `extractArticle` → the pipeline → similar weight), so the clean fix is just to stop claiming it.

### ISS-4 (low) — backtick-as-apostrophe in `explain` schema descriptions

`src/tools/explain.ts` uses escaped backticks as apostrophes inside single-quoted `.describe()` strings — they render to clients as a literal backtick where an apostrophe belongs: `Readability\`s` (`:22`, `:55`, `:60`, `:96`, `:182`), `candidate\`s` (`:49`, `:51`). Reads as a typo in user-visible schema text.

- **Fix:** replace `` \' `` style with a straight apostrophe inside the single-quoted string (`'Readability\'s …'`) or switch the literal to double quotes. (The backticks in *code comments* elsewhere — `server.ts:54`, `chunk.ts:2`, etc. — are fine; this is only the `.describe()` string literals in `explain.ts`.)

### ISS-5 (low) — tautological assertion in `resources.test.ts`

`test/server/resources.test.ts:112-116`:

```ts
expect(firstDiag.cache?.normalizedHash).toBe(
  firstDiag.cache?.originalHash === firstDiag.cache?.normalizedHash
    ? firstDiag.cache?.normalizedHash
    : firstDiag.cache?.normalizedHash,
);
```

Both ternary branches are `firstDiag.cache?.normalizedHash`, so this reduces to `expect(X).toBe(X)` — a no-op that can never fail. The normalized-vs-original relationship is correctly exercised elsewhere in the same file (`:125-126`, `:148-150`); this one is a relic.

- **Fix:** replace with a real assertion (e.g. that `normalizedHash` equals `originalHash` for the nonce-free `PAGE_A` on a fresh cache) or delete it.

### ISS-7 (low) — README lead over-generalizes diagnostics

`README.md:70`: *"All ten always-on tools return MCP structured content (`schemaVersion`, `metadata`, `diagnostics`) validated by a zod `outputSchema`."* Only some do. Verified by output schema: a top-level `diagnostics` key exists only on `extract`/`html_to_markdown`/`extract_section` (they share `outputSchemaShape`) and `extract_list` (`output-schema.ts:157`, `:565`). `explain`, `extract_tables`, `extract_links`, `extract_metadata`, `outline`, and `chunk_text` have no `diagnostics` (and `chunk_text`/`explain` have no `metadata` either). The per-tool sections further down are accurate — only the lead over-generalizes.

- **Fix:** soften the parenthetical to something like "structured content (`schemaVersion` plus a tool-specific payload of `metadata`/`diagnostics`/`items`/…)" so it doesn't promise `diagnostics` on every tool.

### ISS-8 (low) — `TODO.md` contradicts itself about OBS-2b

The OBS-2b precision/recall scorer **did** ship: `test/bench/scorer.ts` implements `scorePrecisionRecall` (`:54-68`) and it is wired into `run.ts` (import `:9`; per-fixture `:59`/`:253`; the precision/recall + macro-average tables `:146-189`), with labels in `test/bench/labels.ts`. `TODO.md:122` marks OBS-2b `[x] Implement`. But the prose says the opposite:

- `TODO.md:9` — *"what remains is the measurement backbone (benchmark harness)"*
- `TODO.md:44` — *"the measurement backbone did not"*
- `TODO.md:46-47` — lists OBS-2b under "Next — measure, then unlock," claiming *"the precision/recall scorer against human-labeled boundaries did not"* ship

The narrative wasn't updated when the scorer landed. (Note: the Shipped list at `TODO.md:24-25` records only the *scaffold*, not the scorer by name — so the clean fix touches both the OBS-2b checkbox context and the intro/sequencing thesis.)

- **Fix:** move OBS-2b fully into the Shipped narrative (name the scorer there) and rewrite lines 9 / 44 / 46-47 so the roadmap no longer claims the measurement backbone is missing. This file gates TGT-3, so the drift is misleading.

---

## Hygiene / efficiency

### ISS-3 (low) — `--stdin` is dead surface

`src/cli.ts`: `ParsedArgs.stdin` (`:14`) is parsed (`:55-56`) but never read — `readHtml` branches on `file` alone (`:77`). Documented inline (`:69-72`) as a "discoverability alias" since stdin is already the default when no file is given, and surfaced in `USAGE` (`:17`) + the README (`:258`). Defensible UX, but in tension with the project's "delete speculative surface" rule.

- **Author's call:** keep the alias (it's documented and harmless) or remove `ParsedArgs.stdin` + the `--stdin` parse branch + its doc mentions. If kept, no action.

### ISS-12 (low) — `extract_section` heading mode parses + normalizes twice

`src/tools/extract_section.ts:39-49` (heading mode): `buildDocument` (parse) → `normalizeDocument` (normalize, **without** `resolveLazyImages`) → `scopeToHeading` → re-serialize `document.body.innerHTML` (`:44`) → `extractArticle({ html: scoped, … })`, which itself calls `buildDocument` (parse again) + `normalizeDocument` + `resolveLazyImages` (`extract.ts:100-132`). For a large page this doubles parse + normalize. Correctness holds (the pipeline is idempotent; the missing first-pass `resolveLazyImages` is harmless only because the downstream `extractArticle` call runs it).

- Purely efficiency. Defeats some of the "without paying for full extraction" promise (README:110). **Fix options:** (a) accept the cost (heading mode is a debug/convenience path, not the hot path) — document it; (b) refactor `extractArticle` to accept a pre-built `Document` so heading mode can hand the already-normalized, already-scoped doc straight through without re-serializing. (b) is the clean fix but touches the extract API surface.

### ISS-13 (low) — duplicated helpers (`headingText`, `isElement`)

- [ ] **`headingText` exists twice.** `policy/chunk.ts:42-45` defines a local `headingText(blockText)` (splits to the first line, then strips `^#{1,6}\s+`), while also importing `headingText as headingLabel` from `policy/markdown.ts` (`:5`, defined `:43-45` as `raw.replace(/^#{1,6}\s+/, '').trim()`). They are functionally equivalent for a heading-anchored block. Consolidate onto one (the char path's first-line split is defensive but unnecessary given the heading is already on the first line — fold it into the shared helper or call the shared one).
- [ ] **`isElement` is byte-identical** in `policy/list-detector.ts:240-242` and `policy/section.ts:73-75` (`node.nodeType === 1`). A one-liner type guard, but the project rule is to converge every variant. Hoist to a shared low-layer helper (e.g. `policy/text.ts` or a new `pipeline/dom` util) and import from both.

### ISS-14 (informational) — accepted: `dev.ts` `oninitialized` captures `first`

`src/dev.ts:70-72` sets `server.server.oninitialized = () => { capabilityGatedHandles = first.registerCapabilityGatedTools(server); }`, closing over `first` (the initial module). On reload, `runOneReload` re-registers capability-gated tools from `next` (`:109`), but the closure still references `first`.

- **Accepted as a non-issue.** stdio is a single connection that initializes exactly once, so `oninitialized` fires only on the initial connect — at which point `first` *is* the correct current module. It never fires again after a reload, so the stale capture has no behavioral impact (the code comment at `:64-72` and `:106-108` documents this). It would only matter if the transport ever supported re-`initialize`, which stdio does not.
- [~-] No action. Noted so a future re-connect-aware transport doesn't inherit the stale closure silently.

---

## Verification notes

- Both reviewers praised items that were checked and are **not** listed here because they are correct: capability gating against the real SDK (`oninitialized` / `getClientCapabilities` / `createMessage`), the `explain` node-ref retention trick, `extract_list`'s `shapeKey`/`distinctPathnames` ranking, the "never fetches" boundary (jsdom constructed with only `{ url }`), the absence of dangling `DESIGN`/`PLAN`/`§` doc references, and the OPS-1 / OPS-4 / `maxNodes` deferrals (documented, deliberate).
- No finding was rejected as factually wrong. ISS-11 and ISS-14 are accurate descriptions that are either documented or behaviorally inert — kept here so the reasoning is on record, not because they demand a fix.
