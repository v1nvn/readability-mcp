import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDocument } from '../../src/pipeline/dom.js';
import { normalizeDocument } from '../../src/pipeline/normalize.js';
import { isReaderable, parseArticle } from '../../src/pipeline/readability.js';
import { sanitizeHtml } from '../../src/pipeline/sanitize.js';
import { toMarkdown } from '../../src/pipeline/turndown.js';
import { resolveReadabilityOptions } from '../../src/policy/resolver.js';
import { extractArticleFromHtml } from '../../src/tools/extract.js';
import type { StructuredContent } from '../../src/tools/output-schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, '../fixtures/react-spa/saved.html');
const pageUrl = 'https://example.com/blog/post';

function loadFixture(): string {
  return readFileSync(fixturePath, 'utf8');
}

function payloadText(result: ReturnType<typeof extractArticleFromHtml>): string {
  const first = result.content[0];
  return first && 'text' in first ? first.text : '';
}

describe('cross-seam: SPA end-to-end', () => {
  it('preserves content, absolutizes the relative image, keeps the table and code block', () => {
    const html = loadFixture();
    const result = extractArticleFromHtml({ html, baseUrl: pageUrl, format: 'markdown', gfm: true });

    expect(result.isError).toBeFalsy();
    const text = payloadText(result);
    expect(text.length).toBeGreaterThan(500);

    expect(text).toContain('https://example.com/static/architecture.png');

    expect(text).toContain('| Strategy');
    expect(text).toMatch(/\|\s+---/);

    expect(text).toMatch(/```tsx/);
    expect(text).toContain('getDerivedStateFromError');

    const structured = result.structuredContent as StructuredContent;
    expect(structured.diagnostics.readerable).toBe(true);
    expect(structured.diagnostics.fallbackUsed).toBe(false);
    expect(structured.diagnostics.truncated).toBe(false);
  });
});

describe('dom.buildDocument', () => {
  it('builds a jsdom document with the given url', () => {
    const { document, window } = buildDocument('<html><body><p>hi</p></body></html>', pageUrl);
    expect(document.querySelector('p')?.textContent).toBe('hi');
    expect(window.document).toBe(document);
  });
});

describe('normalize.normalizeDocument', () => {
  it('strips <base>, <script>, and nonce attributes; reports removed script count', () => {
    const { document } = buildDocument(
      '<html><head><base href="/preview/"></head><body><script nonce="x">a()</script><p nonce="y">keep</p></body></html>',
      pageUrl,
    );
    const counts = normalizeDocument(document);
    expect(document.querySelector('base')).toBeNull();
    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('p')?.getAttribute('nonce')).toBeNull();
    expect(counts.scripts).toBe(1);
    expect(counts.iframes).toBe(0);
  });
});

describe('readability', () => {
  it('isReaderable + parseArticle return an article on the SPA fixture', () => {
    const { document } = buildDocument(loadFixture(), pageUrl);
    normalizeDocument(document);
    expect(isReaderable(document)).toBe(true);
    const article = parseArticle(document, resolveReadabilityOptions({}));
    expect(article).not.toBeNull();
    expect(article?.content).toBeTruthy();
    expect(article?.content).toContain('https://example.com/static/architecture.png');
  });
});

describe('sanitize.sanitizeHtml', () => {
  it('removes a script and an iframe and counts both', () => {
    const { window } = buildDocument('<html></html>', pageUrl);
    const dirty = '<p>ok</p><script>alert(1)</script><iframe src="evil"></iframe>';
    const res = sanitizeHtml(dirty, window);
    expect(res.html).toContain('<p>ok</p>');
    expect(res.html).not.toContain('<script');
    expect(res.html).not.toContain('<iframe');
    expect(res.scriptsRemoved).toBe(1);
    expect(res.iframesRemoved).toBe(1);
  });
});

describe('turndown.toMarkdown', () => {
  it('renders a GFM table and a fenced code block', () => {
    const html =
      '<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>' +
      '<pre><code class="language-ts">const x = 1;</code></pre>' +
      '<img src="/i.png" alt="diagram">';
    const md = toMarkdown(html, { gfm: true, baseUrl: pageUrl });
    expect(md).toMatch(/\|\s+A\s+\|/);
    expect(md).toMatch(/```ts\n/);
    expect(md).toContain('![diagram]');
  });

  it('drops images when images: "drop"', () => {
    const md = toMarkdown('<p>x</p><img src="/i.png" alt="d">', { images: 'drop' });
    expect(md).not.toContain('![d]');
  });
});

describe('policy.resolver', () => {
  it('balanced leaves Readability defaults unset', () => {
    const opts = resolveReadabilityOptions({ extraction: 'balanced' });
    expect(opts.charThreshold).toBeUndefined();
    expect(opts.nbTopCandidates).toBeUndefined();
    expect(opts.keepClasses).toBe(false);
  });

  it('aggressive lowers charThreshold and raises nbTopCandidates', () => {
    const opts = resolveReadabilityOptions({ extraction: 'aggressive' });
    expect(opts.charThreshold).toBeLessThan(500);
    expect(opts.nbTopCandidates).toBeGreaterThan(5);
  });

  it('conservative raises charThreshold and lowers nbTopCandidates', () => {
    const opts = resolveReadabilityOptions({ extraction: 'conservative' });
    expect(opts.charThreshold).toBeGreaterThan(500);
    expect(opts.nbTopCandidates).toBeLessThan(5);
  });

  it('minArticleLength maps to charThreshold and overrides escape-hatch verbatim', () => {
    const opts = resolveReadabilityOptions({
      extraction: 'aggressive',
      minArticleLength: 300,
      maxNodes: 1000,
      readabilityOverrides: { linkDensityModifier: -1 },
    });
    expect(opts.charThreshold).toBe(300);
    expect(opts.maxElemsToParse).toBe(1000);
    expect(opts.linkDensityModifier).toBe(-1);
  });
});
