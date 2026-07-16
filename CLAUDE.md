# Comment hygiene

Comments explain *why*, not *what*.

- Don't restate code the reader can already see. `currentSection = null; // reset section` and `// get all inputs` over a block of `core.getInput(...)` are noise — delete them.
- Don't reference deleted or external documents inline. Tags like `PLAN.md §4`, `D6`, `Option B`, `req 5`, or `the oracle` only mean something while that doc exists; once it's gone the comment dangles. A comment must stand on its own — if the doc is removed, drop the pointer or inline the rationale it pointed at.
- Prefer clear names and types over a comment. When you do comment, capture intent, invariants, and non-obvious decisions only.

- Use TODO.md to track issues, features and all progress.
- Mark a task doneonly when `npm run typecheck && npm run lint:fix` is successful. 
- Alwasys do things cleanly, never put band-aids or hacks.
- Only add comments when absolutely required, never add comments that explain code or refer to a temp doc.