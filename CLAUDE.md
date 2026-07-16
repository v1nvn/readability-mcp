# Comment hygiene

Comments explain *why*, not *what*. The default is no comment. Write one only when it clears the bar below — author to this standard so redundant commentary never gets added in the first place, not cleaned up later.

- Never write a comment that restates code the reader can already see: module-summary headers, numbered step walkthroughs, `x = null; // reset x`. If a name or type doesn't carry the intent, fix the name or type — don't paper over it with a comment.
- Never reference markdown or docs from a code comment — no `DESIGN §4`, `PLAN.md`, `§9`, `see README`, or phase/ID tags (`Phase A`, `QUAL-1`). Rationale must live in the comment itself or not at all; a pointer dangles the moment its doc changes.
- Add a comment only when its absence would mislead a future reader: a non-obvious invariant, a subtle cross-layer contract, or a "why" that prevents a bug. If you can't point to that, the comment doesn't get written.
- `eslint-disable` / `@ts-*` pragmas are functional, not commentary.

- Use TODO.md to track issues, features and all progress.
- Mark a task done only when `npm run typecheck && npm run lint:fix` is successful.
- Always do things cleanly — no band-aids or hacks.