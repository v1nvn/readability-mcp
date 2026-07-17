import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractMetadataDocument } from '../../../src/tools/extract_metadata.js';
import type { ExtractMetadataStructuredContent } from '../../../src/tools/output-schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, 'saved.html');
// Deliberately distinct from the canonical link in the fixture so the test
// proves canonical is resolved from <link rel="canonical">, not echoed from url.
const pageUrl = 'https://example.com/some-other-path';

function payloadText(
  result: ReturnType<typeof extractMetadataDocument>,
): string {
  const first = result.content[0];
  return first && 'text' in first ? first.text : '';
}

describe('golden: metadata saved.html', () => {
  it('resolves the full metadata cascade and canonical (no markdown body)', () => {
    const html = readFileSync(fixturePath, 'utf8');
    const result = extractMetadataDocument({ html, url: pageUrl });

    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as ExtractMetadataStructuredContent;
    const metadata = structured.metadata;

    expect(metadata.title).toBe('Designing Resilient APIs');
    expect(metadata.byline).toBe('Jordan Lee');
    expect(metadata.siteName).toBe('Example Docs');
    expect(metadata.lang).toBe('en');
    expect(metadata.publishedTime).toBe('2026-07-15T08:00:00Z');
    expect(metadata.excerpt).toBe(
      'A guide to building APIs that degrade gracefully under load and partial failure.',
    );
    expect(metadata.canonical).toBe(
      'https://docs.example.com/api-design/resilient',
    );
    expect(metadata.url).toBe(pageUrl);

    // Bibliographic only — these are meaningless without the extracted body.
    expect(metadata).not.toHaveProperty('wordCount');
    expect(metadata).not.toHaveProperty('readingTimeMin');
    expect(metadata).not.toHaveProperty('tokenEstimate');
    expect(metadata).not.toHaveProperty('estimator');

    // content[0].text renders the metadata, not the article body.
    const text = payloadText(result);
    expect(text).toContain('title: Designing Resilient APIs');
    expect(text).toContain(
      'canonical: https://docs.example.com/api-design/resilient',
    );
    expect(text).not.toMatch(/^# /);
    expect(text).not.toContain('Each section pairs a failure mode');
  });
});
