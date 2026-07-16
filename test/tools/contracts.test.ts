import { outputSchema, outlineOutput } from '../../src/tools/output-schema.js';
import { extractArticle, extractHandler } from '../../src/tools/extract.js';
import {
  htmlToMarkdown,
  htmlToMarkdownHandler,
} from '../../src/tools/html_to_markdown.js';
import { outlineDocument, outlineHandler } from '../../src/tools/outline.js';

const SPA_HTML =
  '<html><head><title>Post</title></head><body><article><h1>Title</h1>' +
  '<p>One two three four five six seven eight nine ten.</p></article></body></html>';

describe('extract tool contracts', () => {
  it('returns { isError: true } for an unsalvageable input and does not throw', () => {
    const result = extractHandler({ html: '' });
    expect(result.isError).toBe(true);
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.content[0]).toHaveProperty('type', 'text');
  });

  it('validates structuredContent against the output schema', () => {
    const result = extractArticle({ html: SPA_HTML, url: 'https://x.example/' });
    expect(result.isError).toBeFalsy();
    const parsed = outputSchema.parse(result.structuredContent);
    expect(parsed.content.length).toBeGreaterThan(0);
  });
});

describe('html_to_markdown tool contracts', () => {
  it('returns { isError: true } for invalid args and does not throw', () => {
    const result = htmlToMarkdownHandler({});
    expect(result.isError).toBe(true);
  });

  it('validates structuredContent against the output schema (fallbackUsed=true, fragment)', () => {
    const result = htmlToMarkdown({
      html: '<h2>Heading</h2><p>some fragment text here</p>',
      url: 'https://x.example/',
    });
    expect(result.isError).toBeFalsy();
    const parsed = outputSchema.parse(result.structuredContent);
    expect(parsed.content.length).toBeGreaterThan(0);
    expect(parsed.diagnostics.fallbackUsed).toBe(true);
    expect(parsed.diagnostics.extractedNode).toBe('fragment');
  });
});

describe('outline tool contracts', () => {
  it('returns { isError: true } for invalid args and does not throw', () => {
    const result = outlineHandler({});
    expect(result.isError).toBe(true);
  });

  it('validates structuredContent against the outline output schema', () => {
    const result = outlineDocument({
      html: '<h1>Title</h1><h2>Section</h2>',
      url: 'https://x.example/',
    });
    expect(result.isError).toBeFalsy();
    const parsed = outlineOutput.parse(result.structuredContent);
    expect(parsed.outline.length).toBeGreaterThan(0);
  });
});
