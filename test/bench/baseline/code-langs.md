# Language-Aware Code Extraction — Example Docs

This article walks through the four real-world code-block conventions that the extraction pipeline rewrites into a single canonical form before Readability runs. Each convention carries the language token in a different place — on a wrapper div, on the pre itself, on the code element, or already in canonical form. The canonicalization step unifies them so the resulting Markdown fences carry the correct language tag.

Readability keeps a class only by literal equality against a preserve list, so without canonicalization any non-canonical convention is stripped before conversion and the fence degrades to a bare triple-backtick block. The examples below exercise each path.

## GitHub-flavored source blocks

GitHub renders highlighted source as a wrapper div whose class carries the language as a `highlight-source-X` suffix. The inner pre and code elements carry no language class of their own, so the wrapper is the only signal.

```js
const greet = (name) => {
  return `Hello, ${name}!`;
};
```

Shell snippets use the same wrapper convention with a `highlight-source-shell` suffix, which maps to a shell fence tag.

```shell
npm install --save-exact readability-mcp
```

## Sandpack-style inline blocks

Interactive docs often render code through a sandpack runtime that puts the language directly on the pre element as an `sp-X` class, with no wrapper div. The code child may be present or absent; the pre class is the only hint either way.

```javascript
function sum(a, b) {
  return a + b;
}
```

## Canonical blocks

Blocks that already carry a `language-X` class on their code element need no rewriting — the canonical form is what every other convention is normalized toward, and turndown reads the tag straight off the element.

```ts
const id: number = 42;
```

## Why this matters

Language tags are load-bearing context for downstream consumers of the Markdown: syntax highlighting, token estimation, and model reasoning all benefit from knowing whether a block is JavaScript, shell, or TypeScript. Losing the tag collapses every code block into an undifferentiated string, so canonicalization happens before Readability clones the document rather than after.

The same canonicalization also unwraps redundant wrapper divs so the pre element is scored directly as article content rather than as a payload inside an anonymous container.