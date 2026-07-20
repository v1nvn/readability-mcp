import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { extractTables } from '../../src/tools/extract_tables.js';
import { extractArticle, extractHandler } from '../../src/tools/extract.js';
import { outputSchema } from '../../src/tools/output-schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const docsFixture = join(here, '../fixtures/documentation/saved.html');
const tablesFixture = join(here, '../fixtures/tables/saved.html');

describe('localPath input (the public schema reads HTML from disk)', () => {
  it('extract resolves content from localPath', () => {
    const result = extractArticle({ localPath: docsFixture });
    expect(result.isError).toBeFalsy();
    const parsed = outputSchema.parse(result.structuredContent);
    expect(parsed.content).toContain('# Working with Arrays in TypeScript');
  });

  it('extract_tables resolves tables from localPath', () => {
    const result = extractTables({ localPath: tablesFixture });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { tables: unknown[] };
    expect(sc.tables.length).toBeGreaterThan(0);
  });

  it('rejects when localPath is missing', () => {
    const result = extractHandler({});
    expect(result.isError).toBe(true);
  });

  it('rejects a localPath that does not exist', () => {
    const result = extractHandler({ localPath: '/nonexistent/path.html' });
    expect(result.isError).toBe(true);
  });
});
