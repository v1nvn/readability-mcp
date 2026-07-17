import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractArticle } from '../../../src/tools/extract.js';
import type { StructuredContent } from '../../../src/tools/output-schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, 'saved.html');
const pageUrl = 'https://journal.example.com/citations';

function payloadText(result: ReturnType<typeof extractArticle>): string {
  const first = result.content[0];
  return first && 'text' in first ? first.text : '';
}

describe('footnotes fixture: paired refs + defs become markdown footnotes', () => {
  it('emits inline [^1]/[^2]/[^3] markers plus appended definitions, in matching order', () => {
    const html = readFileSync(fixturePath, 'utf8');
    const result = extractArticle({ html, url: pageUrl });
    expect(result.isError).toBeFalsy();

    const structured = result.structuredContent as StructuredContent;
    expect(structured.diagnostics.readerable).toBe(true);
    expect(structured.diagnostics.fallbackUsed).toBe(false);

    const text = payloadText(result);
    // Inline markers survive Readability + turndown.
    expect(text).toContain('[^1]');
    expect(text).toContain('[^2]');
    expect(text).toContain('[^3]');
    // The definitions block is appended at the end, numbered to match the refs.
    expect(text).toMatch(/\[\^1\]: Grafton/);
    expect(text).toMatch(/\[\^2\]: Wikipedia contributors/);
    expect(text).toMatch(/\[\^3\]: A second definition/);
    // The original rendered references list is removed (would otherwise appear
    // as a GFM numbered list `1.  Grafton...`).
    expect(text).not.toMatch(/^\d+\.\s{2,}Grafton/m);
    expect(text).not.toMatch(/^\d+\.\s{2,}Wikipedia contributors/m);
    // No back-to-text caret leaks into a definition.
    expect(text).not.toMatch(/\[\^\d\]: \^/);
    // Turndown must not backslash-escape our emitted markers.
    expect(text).not.toContain('\\[^1\\]');
  });
});
