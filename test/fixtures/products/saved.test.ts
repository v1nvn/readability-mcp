import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractArticleFromHtml } from '../../../src/tools/extract.js';
import type { StructuredContent } from '../../../src/tools/output-schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, 'saved.html');
const pageUrl = 'https://shop.example.com/audio/acme-wireless-headphones';

describe('product fixture: JSON-LD Product surfaces as metadata.structured', () => {
  it('populates structured with the Product node and preserves offers/rating', () => {
    const html = readFileSync(fixturePath, 'utf8');
    const result = extractArticleFromHtml({ html, baseUrl: pageUrl });

    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as StructuredContent;

    const product = structured.metadata.structured;
    expect(product).toBeDefined();
    expect(product?.['@type']).toBe('Product');
    expect(product?.['name']).toBe('Acme Wireless Headphones');
    expect(product?.['offers']).toMatchObject({
      '@type': 'Offer',
      price: '99.99',
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
    });
    expect(product?.['aggregateRating']).toMatchObject({
      '@type': 'AggregateRating',
      ratingValue: '4.5',
      reviewCount: '128',
    });
    expect(product?.['brand']).toEqual({ '@type': 'Brand', name: 'Acme' });
    expect(product).not.toHaveProperty('@context');
  });

  it('emits the product prose as the article body, not the JSON-LD block', () => {
    const html = readFileSync(fixturePath, 'utf8');
    const result = extractArticleFromHtml({ html, baseUrl: pageUrl });
    const first = result.content[0];
    const text = first && 'text' in first ? first.text : '';
    expect(text).toContain('Acme Wireless Headphones');
    expect(text).toContain('30 hours of playback');
    expect(text).not.toContain('"@type":"Product"');
  });
});
