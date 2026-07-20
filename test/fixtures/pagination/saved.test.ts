import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractArticleFromHtml } from '../../../src/tools/extract.js';
import type { StructuredContent } from '../../../src/tools/output-schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, 'saved.html');
// Relative href in the fixture is absolutized against this url; passing a
// page-1 url proves the next link resolves to page-2 regardless of the path.
const pageUrl = 'https://example.com/guide/page-1';

describe('pagination detection: paginated article', () => {
  it('reports the absolutized nextUrl from <link rel="next">', () => {
    const html = readFileSync(fixturePath, 'utf8');
    const result = extractArticleFromHtml({ html, baseUrl: pageUrl, format: 'markdown' });

    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as StructuredContent;
    expect(structured.diagnostics.pagination).toEqual({
      type: 'paginated',
      nextUrl: 'https://example.com/guide/page-2',
    });
  });
});
