import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractArticle } from '../../../src/tools/extract.js';
import type { StructuredContent } from '../../../src/tools/output-schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, 'saved.html');
const pageUrl = 'https://docs.example.com/guides/tables';

function payloadText(result: ReturnType<typeof extractArticle>): string {
  const first = result.content[0];
  return first && 'text' in first ? first.text : '';
}

describe('tables fixture: matrix IR renders all three formats from one parse', () => {
  it('renders a csv block with rowspan/colspan resolved', () => {
    const html = readFileSync(fixturePath, 'utf8');
    const result = extractArticle({
      html,
      tables: 'csv',
      url: pageUrl,
    });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as StructuredContent;
    expect(structured.diagnostics.fallbackUsed).toBe(false);

    const text = payloadText(result);
    // The colspan=2 "Person" header occupies col 0 only; col 1 is empty (spanned).
    // The rowspan=2 "Notes" header occupies row 0 col 2; row 1 col 2 is empty.
    expect(text).toContain('```csv');
    expect(text).toContain('Person,,Notes');
    expect(text).toContain('Name,Age,');
    expect(text).toContain('Alice,30,"hello, world"');
    expect(text).toContain('"""quoted"""');
    // Headerless table: row 0 (Apple / $1.00) becomes the header.
    expect(text).toContain('Apple,$1.00');
    expect(text).toContain('Banana,$0.50');
  });

  it('renders a json block keyed by the header row', () => {
    const html = readFileSync(fixturePath, 'utf8');
    const result = extractArticle({ html, tables: 'json', url: pageUrl });
    const text = payloadText(result);
    expect(text).toContain('```json');
    const fenced = text.match(/```json\n([\s\S]+?)\n```/);
    expect(fenced).not.toBeNull();
    const records = JSON.parse(fenced![1]!) as Record<string, string>[];
    // The headered table contributes 3 data records (row 0 is the JSON header):
    // the second HTML header row plus the two body rows. The headerless table
    // then contributes 1 record (its row 0 is the header, its row 1 is data).
    expect(records.find(r => r.Person === 'Alice')).toMatchObject({
      Notes: 'hello, world',
      column_1: '30',
    });
    expect(records.find(r => r.Person === 'Bob')).toMatchObject({
      Notes: '"quoted"',
    });
  });

  it('renders a native GFM table (no fenced block) when tables=gfm', () => {
    const html = readFileSync(fixturePath, 'utf8');
    const result = extractArticle({ html, tables: 'gfm', url: pageUrl });
    const text = payloadText(result);
    // The GFM renderer emits a delimiter row; the csv/json code fences are absent.
    expect(text).toContain('| Person |  | Notes |');
    expect(text).toContain('| --- | --- | --- |');
    expect(text).not.toContain('```gfm');
    expect(text).not.toContain('```csv');
  });

  it('leaves stock turndown handling intact when tables is unset', () => {
    const html = readFileSync(fixturePath, 'utf8');
    const result = extractArticle({ html, url: pageUrl });
    const text = payloadText(result);
    // No matrix-IR code blocks; the stock gfm plugin handles the headered table.
    expect(text).not.toContain('```csv');
    expect(text).not.toContain('```json');
  });
});
