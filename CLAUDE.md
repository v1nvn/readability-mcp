# Comment hygiene

Comments explain *why*, not *what*. The default is no comment. Write one only when it clears the bar below — author to this standard so redundant commentary never gets added in the first place, not cleaned up later.

- Never write a comment that restates code the reader can already see: module-summary headers, numbered step walkthroughs, `x = null; // reset x`. If a name or type doesn't carry the intent, fix the name or type — don't paper over it with a comment.
- Never reference markdown or docs from a code comment — no `DESIGN §4`, `PLAN.md`, `§9`, `see README`, or phase/ID tags (`Phase A`, `QUAL-1`). Rationale must live in the comment itself or not at all; a pointer dangles the moment its doc changes.
- Add a comment only when its absence would mislead a future reader: a non-obvious invariant, a subtle cross-layer contract, or a "why" that prevents a bug. If you can't point to that, the comment doesn't get written.
- `eslint-disable` / `@ts-*` pragmas are functional, not commentary.

- Use TODO.md to track issues, features and all progress.
- Mark a task done only when `npm run typecheck && npm run lint:fix` is successful.
- Always do things cleanly — no band-aids or hacks.

# Shared helpers & layering

- A helper belongs in exactly one place — before copying logic, extract it, and converge *every* variant including partial/drifted twins (a `*Exclude`-only copy of a fuller helper still gets folded in or deleted).
- Imports flow one way, `pipeline/` → `policy/` → `tools/`; a helper lives in the lowest layer that uses it, never the reverse.
- Don't import upward for a type — give the lower layer its own local structural type; structural compatibility keeps callers working without inverting the dependency.
- Delete speculative surface (unused option, unreachable branch) rather than carrying it for a caller that doesn't exist.
- Don't hand-roll code for which a well maintained library exists

# MCP documentation

The server documents itself to clients on introspection — never ship a tool, schema field, or identity value that a client would see as blank.

- **Server identity.** `config.ts` exposes `title` and `description` (MCP `Implementation`) and `instructions` (`ServerOptions`), wired through `createMcpServer` in `server.ts`. All three populate `initialize`/`getServerVersion()`/`getInstructions()`.
- **Tool metadata.** Every `registerTool` call carries a human `title` plus a `description`.
- **Schema descriptions.** Every input and output zod field carries `.describe()` — including fields inside nested objects (`metadata`, `diagnostics`, `sanitization`, `outline[]`). No field a client introspects may be undocumented.
- **Idiom.** Use `.describe(...).default(...)` (describe before default). This survives the SDK's `zod/v4-mini` → JSON-schema conversion and lands in the wire schema.
- **README consistency.** Keep the README in sync with the schemas — tool count, field lists, and never a dangling doc reference (e.g. `DESIGN §x`) to a file that doesn't exist.