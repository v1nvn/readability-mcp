import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractArticleFromHtml } from '../../../src/tools/extract.js';
import type { StructuredContent } from '../../../src/tools/output-schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, 'saved.html');
const pageUrl = 'https://example.com/blog/long-migration';

describe('pagination detection: infinite scroll', () => {
  it('reports the load-more sentinel selector with no nextUrl', () => {
    const html = readFileSync(fixturePath, 'utf8');
    const result = extractArticleFromHtml({ html, baseUrl: pageUrl, format: 'markdown' });

    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as StructuredContent;
    // The fixture carries both [data-load-more] and a load-more class; the
    // attribute selector is checked first, so it wins.
    expect(structured.diagnostics.pagination).toEqual({
      type: 'infinite',
      selector: '[data-load-more]',
    });
    expect(structured.diagnostics.pagination?.nextUrl).toBeUndefined();
  });
});
