import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDocument } from '../../../src/pipeline/dom.js';
import { stripChrome } from '../../../src/pipeline/normalize.js';
import { extractArticleFromHtml } from '../../../src/tools/extract.js';
import type { StructuredContent } from '../../../src/tools/output-schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, 'saved.html');
const pageUrl = 'https://example.com/feature/urban-cycling';

describe('paywall detection: soft-paywalled article', () => {
  it('flags diagnostics.gated with a likely signal and a non-empty reason', () => {
    const html = readFileSync(fixturePath, 'utf8');
    const result = extractArticleFromHtml({ html, baseUrl: pageUrl, format: 'markdown' });

    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as StructuredContent;
    expect(structured.diagnostics.gated).toEqual({
      likely: true,
      reason: expect.any(String),
    });
    expect(structured.diagnostics.gated?.reason.length).toBeGreaterThan(0);
  });

  it('still extracts the article body — the overlay is a signal, not a blocker', () => {
    const html = readFileSync(fixturePath, 'utf8');
    const result = extractArticleFromHtml({ html, baseUrl: pageUrl, format: 'markdown' });

    const structured = result.structuredContent as StructuredContent;
    expect(structured.diagnostics.readerable).toBe(true);
    expect(structured.content.length).toBeGreaterThan(0);
    expect(structured.content).toContain('Protected lanes');
  });

  // The overlay carries role="dialog", aria-modal="true", AND a full-viewport
  // fixed style — three independent stripChrome targets. normalizeDocument
  // would remove it (and its text) before detection ran. The fact that gating
  // is populated at all proves detection ran PRE-normalize.
  it('overlay qualifies as a stripChrome target (pre-normalize ordering is load-bearing)', () => {
    const html = readFileSync(fixturePath, 'utf8');
    const { document } = buildDocument(html, pageUrl);
    const before = document.querySelector('.tp-modal');
    expect(before?.isConnected).toBe(true);
    const removed = stripChrome(document);
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(document.querySelector('.tp-modal')).toBeNull();
  });
});
