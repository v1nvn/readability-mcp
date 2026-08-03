import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  extractGridFromHtml,
  extractGridHandler,
} from '../../src/tools/extract_grid.js';
import { extractGridOutput } from '../../src/tools/output-schema.js';
import { extractGridInputSchema } from '../../src/tools/schemas.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, '../fixtures/grid/saved.html');
const ORIGIN = 'https://example.example/research/acme';

// A 4-col, 3-row CSS grid: the div equivalent of a small table. The header
// row shares the row class so it lands in the same shape group as the data.
const GRID_HTML =
  '<div class="grid">' +
  '<div class="row"><div class="cell">Name</div><div class="cell">2027E</div><div class="cell">2028E</div><div class="cell">2029E</div></div>' +
  '<div class="row"><div class="cell">Revenue</div><div class="cell">$1.2B</div><div class="cell">$1.5B</div><div class="cell">$1.8B</div></div>' +
  '<div class="row"><div class="cell">EPS</div><div class="cell">$2.10</div><div class="cell">$2.80</div><div class="cell">$3.50</div></div>' +
  '</div>';

describe('extract_grid tool', () => {
  it('auto-detects the grid and renders GFM with a delimiter row', () => {
    const result = extractGridFromHtml({ html: GRID_HTML, baseUrl: ORIGIN });
    expect(result.isError).toBeFalsy();
    const parsed = extractGridOutput.parse(result.structuredContent);
    expect(parsed.diagnostics.detected).toBe(true);
    expect(parsed.diagnostics.rowTag).toBe('DIV');
    expect(parsed.grid.rows).toBe(3);
    expect(parsed.grid.cols).toBe(4);
    const lines = parsed.grid.markdown.split('\n');
    expect(lines[0]).toBe('| Name | 2027E | 2028E | 2029E |');
    expect(lines[1]).toBe('| --- | --- | --- | --- |');
    expect(lines[2]).toBe('| Revenue | $1.2B | $1.5B | $1.8B |');
    expect(lines[3]).toBe('| EPS | $2.10 | $2.80 | $3.50 |');
    expect(parsed.metadata.detected).toBe(true);
    expect(parsed.metadata.format).toBe('gfm');
    expect(parsed.metadata.baseUrl).toBe(ORIGIN);
  });

  it('renders CSV with the header row first', () => {
    const result = extractGridFromHtml({ html: GRID_HTML, format: 'csv' });
    const parsed = extractGridOutput.parse(result.structuredContent);
    // Dollar values contain no comma, so no quoting is exercised here; the
    // header row leads and each row is comma-joined.
    expect(parsed.grid.markdown.split('\n')).toEqual([
      'Name,2027E,2028E,2029E',
      'Revenue,$1.2B,$1.5B,$1.8B',
      'EPS,$2.10,$2.80,$3.50',
    ]);
  });

  it('emits JSON rows keyed by the header row', () => {
    const result = extractGridFromHtml({ html: GRID_HTML, format: 'json' });
    const parsed = extractGridOutput.parse(result.structuredContent);
    const records = JSON.parse(parsed.grid.markdown) as Record<
      string,
      string
    >[];
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      Name: 'Revenue',
      '2027E': '$1.2B',
      '2029E': '$1.8B',
    });
    expect(records[1]).toMatchObject({ Name: 'EPS', '2028E': '$2.80' });
  });

  it('uses explicit rowSelector + cellSelector in selector mode', () => {
    const html =
      '<div class="estimates">' +
      '<div class="est-row"><span class="est-cell">A</span><span class="est-cell">B</span></div>' +
      '<div class="est-row"><span class="est-cell">C</span><span class="est-cell">D</span></div>' +
      '<div class="est-row"><span class="est-cell">E</span><span class="est-cell">F</span></div>' +
      '</div>';
    const result = extractGridFromHtml({
      html,
      rowSelector: '.est-row',
      cellSelector: '.est-cell',
    });
    const parsed = extractGridOutput.parse(result.structuredContent);
    expect(parsed.diagnostics.detected).toBe(true);
    expect(parsed.diagnostics.rowTag).toBe('DIV');
    expect(parsed.grid.rows).toBe(3);
    expect(parsed.grid.cols).toBe(2);
    expect(parsed.grid.markdown).toContain('| A | B |');
    expect(parsed.grid.markdown).toContain('| E | F |');
  });

  it('round-trips the saved.html fixture (six rows, all three formats)', () => {
    const html = readFileSync(fixturePath, 'utf8');
    const gfm = extractGridFromHtml({ html, baseUrl: ORIGIN, format: 'gfm' });
    const parsed = extractGridOutput.parse(gfm.structuredContent);
    expect(parsed.diagnostics.detected).toBe(true);
    expect(parsed.diagnostics.rowTag).toBe('DIV');
    expect(parsed.diagnostics.rowCount).toBe(6);
    expect(parsed.diagnostics.colCount).toBe(4);
    expect(parsed.diagnostics.confidence).toBe('high');
    expect(parsed.grid.markdown).toContain('| Line Item | 2027E | 2028E | 2029E |');
    expect(parsed.grid.markdown).toContain('| Revenue | $1,200M | $1,500M | $1,800M |');

    const json = extractGridFromHtml({ html, baseUrl: ORIGIN, format: 'json' });
    const jsonParsed = extractGridOutput.parse(json.structuredContent);
    const records = JSON.parse(jsonParsed.grid.markdown) as Record<
      string,
      string
    >[];
    expect(records).toHaveLength(5);
    expect(records[0]).toMatchObject({
      'Line Item': 'Revenue',
      '2029E': '$1,800M',
    });

    const csv = extractGridFromHtml({ html, baseUrl: ORIGIN, format: 'csv' });
    const csvParsed = extractGridOutput.parse(csv.structuredContent);
    // The embedded comma in "$1,200M" forces CSV quoting.
    expect(csvParsed.grid.markdown).toContain('"$1,200M"');
    expect(csvParsed.grid.markdown).toContain('Line Item,2027E,2028E,2029E');
  });

  it('returns (no repeating grid found) for an article page', () => {
    const result = extractGridFromHtml({
      html: '<article><h1>Title</h1><p>prose only</p></article>',
    });
    const parsed = extractGridOutput.parse(result.structuredContent);
    expect(parsed.diagnostics.detected).toBe(false);
    expect(parsed.grid.rows).toBe(0);
    expect(parsed.grid.cols).toBe(0);
    expect(parsed.grid.markdown).toBe('');
    expect(parsed.content).toBe('(no repeating grid found)');
    expect(parsed.metadata.detected).toBe(false);
    const first = result.content[0]!;
    expect('text' in first && first.text).toBe('(no repeating grid found)');
  });

  it('pads ragged rows so the rendered GFM stays rectangular', () => {
    const html =
      '<div class="grid">' +
      '<div class="row"><div>a</div><div>b</div><div>c</div></div>' +
      '<div class="row"><div>d</div><div>e</div></div>' +
      '<div class="row"><div>f</div><div>g</div><div>h</div></div>' +
      '</div>';
    const result = extractGridFromHtml({ html, format: 'gfm' });
    const parsed = extractGridOutput.parse(result.structuredContent);
    expect(parsed.diagnostics.detected).toBe(true);
    expect(parsed.grid.cols).toBe(3);
    // The GFM delimiter has 3 columns; every data row aligns to it.
    expect(parsed.grid.markdown).toContain('| --- | --- | --- |');
    expect(parsed.grid.markdown).toContain('| d | e |  |');
  });

  it('defaults format to gfm when format is omitted', () => {
    const result = extractGridFromHtml({ html: GRID_HTML });
    const parsed = extractGridOutput.parse(result.structuredContent);
    expect(parsed.metadata.format).toBe('gfm');
    expect(parsed.grid.markdown).toContain('| --- | --- | --- | --- |');
  });

  it('scopes auto-detection to the selectors.include subtree', () => {
    const html =
      '<div id="a"><div class="row"><div>a1</div><div>a2</div></div>' +
      '<div class="row"><div>b1</div><div>b2</div></div>' +
      '<div class="row"><div>c1</div><div>c2</div></div></div>' +
      '<div id="b"><div class="row"><div>x1</div><div>x2</div></div></div>';
    const result = extractGridFromHtml({
      html,
      baseUrl: ORIGIN,
      selectors: { include: '#a' },
    });
    const parsed = extractGridOutput.parse(result.structuredContent);
    expect(parsed.diagnostics.detected).toBe(true);
    expect(parsed.grid.rows).toBe(3);
    expect(parsed.grid.markdown).toContain('a1');
    expect(parsed.grid.markdown).not.toContain('x1');
  });

  it('returns { isError: true } for missing args and does not throw', () => {
    const result = extractGridHandler({});
    expect(result.isError).toBe(true);
    expect(result.content.length).toBeGreaterThan(0);
  });

  it('rejects rowSelector without cellSelector (both-or-neither)', () => {
    // The schema superRefine fires before the handler runs.
    expect(() =>
      extractGridInputSchema.parse({
        localPath: '/dev/null',
        rowSelector: '.row',
      }),
    ).toThrow();
    // The handler wraps the throw into an { isError: true } result.
    const result = extractGridHandler({
      localPath: '/dev/null',
      rowSelector: '.row',
    });
    expect(result.isError).toBe(true);
  });
});
