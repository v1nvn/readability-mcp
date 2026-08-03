import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractGridFromHtml } from '../../../src/tools/extract_grid.js';
import { extractGridOutput } from '../../../src/tools/output-schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, 'saved.html');
const pageUrl = 'https://example.example/research/acme';

function payloadText(result: ReturnType<typeof extractGridFromHtml>): string {
  const first = result.content[0];
  return first && 'text' in first ? first.text : '';
}

describe('grid fixture: a div CSS-grid renders through the table renderer', () => {
  it('auto-detects the estimate rows and renders GFM with the year header', () => {
    const html = readFileSync(fixturePath, 'utf8');
    const result = extractGridFromHtml({ html, baseUrl: pageUrl });
    expect(result.isError).toBeFalsy();
    const parsed = extractGridOutput.parse(result.structuredContent);
    expect(parsed.diagnostics.detected).toBe(true);
    expect(parsed.diagnostics.rowTag).toBe('DIV');
    expect(parsed.diagnostics.rowCount).toBe(6);
    expect(parsed.diagnostics.colCount).toBe(4);
    expect(parsed.diagnostics.confidence).toBe('high');

    const text = payloadText(result);
    // Row 0 is the header (Line Item, 2027E, 2028E, 2029E); the delimiter
    // follows it; data rows carry the consensus values.
    expect(text).toContain('| Line Item | 2027E | 2028E | 2029E |');
    expect(text).toContain('| --- | --- | --- | --- |');
    expect(text).toContain('| Revenue | $1,200M | $1,500M | $1,800M |');
    expect(text).toContain('| Net Income | $210M | $295M | $380M |');
    expect(parsed.metadata.detected).toBe(true);
    expect(parsed.metadata.format).toBe('gfm');
  });

  it('renders json keyed by the header (year) row', () => {
    const html = readFileSync(fixturePath, 'utf8');
    const result = extractGridFromHtml({
      html,
      baseUrl: pageUrl,
      format: 'json',
    });
    const parsed = extractGridOutput.parse(result.structuredContent);
    const records = JSON.parse(parsed.grid.markdown) as Record<
      string,
      string
    >[];
    // Row 0 is the JSON header; rows 1-5 are data records.
    expect(records).toHaveLength(5);
    expect(records[0]).toMatchObject({
      'Line Item': 'Revenue',
      '2027E': '$1,200M',
      '2028E': '$1,500M',
      '2029E': '$1,800M',
    });
    expect(records[4]).toMatchObject({
      'Line Item': 'Net Income',
      '2029E': '$380M',
    });
  });

  it('renders csv with the header row first', () => {
    const html = readFileSync(fixturePath, 'utf8');
    const result = extractGridFromHtml({
      html,
      baseUrl: pageUrl,
      format: 'csv',
    });
    const parsed = extractGridOutput.parse(result.structuredContent);
    const lines = parsed.grid.markdown.split('\n');
    expect(lines[0]).toBe('Line Item,2027E,2028E,2029E');
    // Embedded commas in "$1,200M" force RFC-4180 quoting.
    expect(lines[1]).toBe('Revenue,"$1,200M","$1,500M","$1,800M"');
  });
});
