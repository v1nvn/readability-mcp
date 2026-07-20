import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  extractTablesFromHtml,
  extractTablesHandler,
} from '../../src/tools/extract_tables.js';
import { extractTablesOutput } from '../../src/tools/output-schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, '../fixtures/tables/saved.html');
const ORIGIN = 'https://docs.example.com/guides/tables';

// Colspan=2 lifts "Person" over two sub-columns; rowspan=2 lifts "Notes" over
// the second header row. The body carries a comma cell and a quote cell so CSV
// quoting is exercised alongside the span resolution.
const SPAN_HTML =
  '<table><thead>' +
  '<tr><th colspan="2">Person</th><th rowspan="2">Notes</th></tr>' +
  '<tr><th>Name</th><th>Age</th></tr>' +
  '</thead><tbody>' +
  '<tr><td>Alice</td><td>30</td><td>hello, world</td></tr>' +
  '<tr><td>Bob</td><td>25</td><td>"quoted"</td></tr>' +
  '</tbody></table>';

describe('extract_tables tool', () => {
  it('renders the rowspan/colspan matrix as GFM with a delimiter row', () => {
    const result = extractTablesFromHtml({ html: SPAN_HTML, baseUrl: ORIGIN });
    expect(result.isError).toBeFalsy();
    const parsed = extractTablesOutput.parse(result.structuredContent);
    expect(parsed.tables).toHaveLength(1);
    const table = parsed.tables[0]!;
    expect(table.rows).toBe(4);
    expect(table.cols).toBe(3);
    // Span origins carry the text; spanned cells render as empty reserved cells.
    const lines = table.markdown.split('\n');
    expect(lines[0]).toBe('| Person |  | Notes |');
    expect(lines[1]).toBe('| --- | --- | --- |');
    expect(lines[2]).toBe('| Name | Age |  |');
    expect(lines[3]).toBe('| Alice | 30 | hello, world |');
    expect(lines[4]).toBe('| Bob | 25 | "quoted" |');
    expect(parsed.metadata.tableCount).toBe(1);
    expect(parsed.metadata.format).toBe('gfm');
    expect(parsed.metadata.baseUrl).toBe(ORIGIN);
  });

  it('quotes CSV fields containing commas and doubles embedded quotes', () => {
    const result = extractTablesFromHtml({ html: SPAN_HTML, format: 'csv' });
    const parsed = extractTablesOutput.parse(result.structuredContent);
    const csv = parsed.tables[0]!.markdown;
    // Comma in "hello, world" forces quoting; embedded quote in "quoted" doubles.
    expect(csv).toContain('Person,,Notes');
    expect(csv).toContain('Name,Age,');
    expect(csv).toContain('"hello, world"');
    expect(csv).toContain('"""quoted"""');
  });

  it('emits JSON rows keyed by the header row', () => {
    const result = extractTablesFromHtml({ html: SPAN_HTML, format: 'json' });
    const parsed = extractTablesOutput.parse(result.structuredContent);
    const records = JSON.parse(parsed.tables[0]!.markdown) as Record<
      string,
      string
    >[];
    // Row 0 is the JSON header; rows 1-3 are data (including the second HTML
    // header row, which the row-0-keyed IR cannot distinguish from data).
    expect(records).toHaveLength(3);
    expect(records[1]).toMatchObject({
      Person: 'Alice',
      column_1: '30',
      Notes: 'hello, world',
    });
    expect(records[2]).toMatchObject({
      Person: 'Bob',
      Notes: '"quoted"',
    });
  });

  it('round-trips the saved.html fixture (two tables, all three formats)', () => {
    const html = readFileSync(fixturePath, 'utf8');
    const gfm = extractTablesFromHtml({ html, baseUrl: ORIGIN, format: 'gfm' });
    const parsed = extractTablesOutput.parse(gfm.structuredContent);
    // The fixture has two <table> elements (headered + headerless), both inside
    // <article>. Both are emitted in document order.
    expect(parsed.tables.map(t => t.index)).toEqual([0, 1]);
    expect(parsed.metadata.tableCount).toBe(2);
    // Span origins and CSV-quotable cells from the first table survive.
    expect(parsed.tables[0]!.markdown).toContain('Person');
    expect(parsed.tables[0]!.markdown).toContain('Notes');
    expect(parsed.tables[1]!.markdown).toContain('Apple');

    const csv = extractTablesFromHtml({ html, format: 'csv' });
    const csvParsed = extractTablesOutput.parse(csv.structuredContent);
    expect(csvParsed.tables[0]!.markdown).toContain('"hello, world"');
    expect(csvParsed.tables[0]!.markdown).toContain('"""quoted"""');

    const json = extractTablesFromHtml({ html, format: 'json' });
    const jsonParsed = extractTablesOutput.parse(json.structuredContent);
    expect(
      JSON.parse(jsonParsed.tables[0]!.markdown) as Record<string, string>[],
    ).toHaveLength(3);
  });

  it('captures tables outside the article body (nav, aside, footer)', () => {
    // extract's `tables` option would only see the one inside <article>; this
    // tool ignores the article boundary entirely.
    const html =
      '<body>' +
      '<nav><table><tr><th>Nav</th></tr><tr><td>nav-cell</td></tr></table></nav>' +
      '<article><p>prose</p><table><tr><td>A</td><td>B</td></tr></table></article>' +
      '<aside><table><tr><th>Aside</th></tr><tr><td>aside-cell</td></tr></table></aside>' +
      '<footer><table><tr><td>footer-cell</td></tr></table></footer>' +
      '</body>';
    const result = extractTablesFromHtml({ html, baseUrl: ORIGIN });
    const parsed = extractTablesOutput.parse(result.structuredContent);
    expect(parsed.metadata.tableCount).toBe(4);
    expect(parsed.tables.map(t => t.index)).toEqual([0, 1, 2, 3]);
    // Order is document order: nav, article, aside, footer.
    expect(parsed.tables[0]!.markdown).toContain('nav-cell');
    expect(parsed.tables[1]!.markdown).toContain('| A | B |');
    expect(parsed.tables[2]!.markdown).toContain('aside-cell');
    expect(parsed.tables[3]!.markdown).toContain('footer-cell');
  });

  it('emits a nested <table> as its own entry in document order', () => {
    // parseTableMatrix walks only the parent's direct THEAD/TBODY/TFOOT rows, so
    // the nested table's rows do not become rows of the parent's matrix;
    // querySelectorAll then returns the nested table as its own entry.
    const html =
      '<table><tbody>' +
      '<tr><td>outer</td><td><table><tr><td>inner</td></tr></table></td></tr>' +
      '</tbody></table>';
    const result = extractTablesFromHtml({ html });
    const parsed = extractTablesOutput.parse(result.structuredContent);
    expect(parsed.metadata.tableCount).toBe(2);
    // The parent is a single-row matrix; the nested one is emitted separately.
    expect(parsed.tables[0]!.rows).toBe(1);
    expect(parsed.tables[0]!.markdown).toContain('outer');
    expect(parsed.tables[1]!.rows).toBe(1);
    expect(parsed.tables[1]!.markdown).toContain('inner');
  });

  it('skips empty <table> elements and keeps emitted indices contiguous', () => {
    const html =
      '<table></table>' +
      '<table><tr><td>real</td></tr></table>' +
      '<table></table>';
    const result = extractTablesFromHtml({ html });
    const parsed = extractTablesOutput.parse(result.structuredContent);
    expect(parsed.metadata.tableCount).toBe(1);
    expect(parsed.tables[0]!.index).toBe(0);
    expect(parsed.tables[0]!.markdown).toContain('real');
  });

  it('returns (no tables found) and an empty tables array when there are none', () => {
    const result = extractTablesFromHtml({ html: '<p>no tables here</p>' });
    const parsed = extractTablesOutput.parse(result.structuredContent);
    expect(parsed.tables).toEqual([]);
    expect(parsed.metadata.tableCount).toBe(0);
    expect(parsed.content).toBe('(no tables found)');
    // content[0].text mirrors structuredContent.content.
    const first = result.content[0]!;
    expect('text' in first && first.text).toBe('(no tables found)');
  });

  it('returns { isError: true } for missing html and does not throw', () => {
    const result = extractTablesHandler({});
    expect(result.isError).toBe(true);
    expect(result.content.length).toBeGreaterThan(0);
  });

  it('defaults format to gfm when format is omitted', () => {
    const result = extractTablesFromHtml({ html: SPAN_HTML });
    const parsed = extractTablesOutput.parse(result.structuredContent);
    expect(parsed.metadata.format).toBe('gfm');
    expect(parsed.tables[0]!.markdown).toContain('| --- | --- | --- |');
  });

  it('scopes the table walk to the selectors.include subtree', () => {
    const html =
      '<div id="a"><table><tr><th>A</th></tr><tr><td>Alpha</td></tr></table></div>' +
      '<div id="b"><table><tr><th>B</th></tr><tr><td>Beta</td></tr></table></div>';
    const result = extractTablesFromHtml({
      html,
      baseUrl: ORIGIN,
      selectors: { include: '#a' },
    });
    const parsed = extractTablesOutput.parse(result.structuredContent);
    expect(parsed.metadata.tableCount).toBe(1);
    expect(parsed.tables[0]!.markdown).toContain('Alpha');
    expect(parsed.tables[0]!.markdown).not.toContain('Beta');
  });

  it('drops tables matched by selectors.exclude anywhere on the page', () => {
    const html =
      '<div id="a"><table><tr><td>Alpha</td></tr></table></div>' +
      '<aside class="ads"><table><tr><td>Ad</td></tr></table></aside>';
    const result = extractTablesFromHtml({
      html,
      baseUrl: ORIGIN,
      selectors: { exclude: ['.ads'] },
    });
    const parsed = extractTablesOutput.parse(result.structuredContent);
    expect(parsed.metadata.tableCount).toBe(1);
    expect(parsed.tables[0]!.markdown).toContain('Alpha');
  });
});
