import {
  extractMetadataDocumentFromHtml,
  extractMetadataHandler,
} from '../../src/tools/extract_metadata.js';
import {
  extractArticleFromHtml,
  extractHandler,
} from '../../src/tools/extract.js';
import {
  htmlToMarkdownFromHtml,
  htmlToMarkdownHandler,
} from '../../src/tools/html_to_markdown.js';
import {
  extractMetadataOutput,
  outputSchema,
  outlineOutput,
} from '../../src/tools/output-schema.js';
import {
  outlineDocumentFromHtml,
  outlineHandler,
} from '../../src/tools/outline.js';

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
    const result = extractArticleFromHtml({
      html: SPA_HTML,
      baseUrl: 'https://x.example/',
    });
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
    const result = htmlToMarkdownFromHtml({
      html: '<h2>Heading</h2><p>some fragment text here</p>',
      baseUrl: 'https://x.example/',
    });
    expect(result.isError).toBeFalsy();
    const parsed = outputSchema.parse(result.structuredContent);
    expect(parsed.content.length).toBeGreaterThan(0);
    expect(parsed.diagnostics.fallbackUsed).toBe(true);
    expect(parsed.diagnostics.extractedNode).toBe('fragment');
  });

  it('emits tokenEstimate and estimator in structuredContent.metadata', () => {
    const result = htmlToMarkdownFromHtml({
      html: '<h2>Heading</h2><p>some fragment text here</p>',
      baseUrl: 'https://x.example/',
    });
    const metadata = result.structuredContent?.metadata as
      | { estimator?: string; tokenEstimate?: number }
      | undefined;
    expect(typeof metadata?.tokenEstimate).toBe('number');
    expect(metadata?.estimator).toBe('chars/4');
  });
});

describe('outline tool contracts', () => {
  it('returns { isError: true } for invalid args and does not throw', () => {
    const result = outlineHandler({});
    expect(result.isError).toBe(true);
  });

  it('validates structuredContent against the outline output schema', () => {
    const result = outlineDocumentFromHtml({
      html: '<h1>Title</h1><h2>Section</h2>',
      baseUrl: 'https://x.example/',
    });
    expect(result.isError).toBeFalsy();
    const parsed = outlineOutput.parse(result.structuredContent);
    expect(parsed.outline.length).toBeGreaterThan(0);
  });
});

describe('extract_metadata tool contracts', () => {
  it('returns { isError: true } for invalid args and does not throw', () => {
    const result = extractMetadataHandler({});
    expect(result.isError).toBe(true);
  });

  it('validates structuredContent against the extract_metadata output schema and surfaces canonical', () => {
    const result = extractMetadataDocumentFromHtml({
      html: '<html><head><title>X</title><link rel="canonical" href="https://x.example/c"></head><body></body></html>',
      baseUrl: 'https://x.example/',
    });
    expect(result.isError).toBeFalsy();
    const parsed = extractMetadataOutput.parse(result.structuredContent);
    expect(parsed.metadata.canonical).toBe('https://x.example/c');
    expect(parsed.metadata.title).toBe('X');
    expect(parsed.metadata.baseUrl).toBe('https://x.example/');
  });
});
