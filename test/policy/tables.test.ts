import { buildDocument } from '../../src/pipeline/dom.js';
import {
  parseTableMatrix,
  renderTable,
  renderTableCsv,
  renderTableGfm,
  renderTableJson,
  resolveHeaderKeys,
} from '../../src/policy/tables.js';

function table(html: string): Element {
  const { document } = buildDocument(`<html><body>${html}</body></html>`);
  const el = document.querySelector('table');
  if (!el) {
    throw new Error(`no <table> in fixture: ${html}`);
  }
  return el;
}

describe('policy.tables parseTableMatrix', () => {
  it('parses a simple 2x2 headered table', () => {
    const matrix = parseTableMatrix(
      table(
        '<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>',
      ),
    );
    expect(matrix).toEqual([
      ['A', 'B'],
      ['1', '2'],
    ]);
  });

  it('resolves colspan by occupying extra columns', () => {
    const matrix = parseTableMatrix(
      table(
        '<table><thead><tr><th colspan="2">IDs</th><th>Notes</th></tr></thead>' +
          '<tbody><tr><td>u1</td><td>g1</td><td>n1</td></tr></tbody></table>',
      ),
    );
    expect(matrix).toEqual([
      // IDs occupies col 0 and col 1; only placed once at origin.
      ['IDs', '', 'Notes'],
      ['u1', 'g1', 'n1'],
    ]);
  });

  it('resolves rowspan by leaving later-row cells empty', () => {
    const matrix = parseTableMatrix(
      table(
        '<table><thead><tr><th>K</th><th>V</th></tr></thead>' +
          '<tbody><tr><td rowspan="2">shared</td><td>a</td></tr>' +
          '<tr><td>b</td></tr></tbody></table>',
      ),
    );
    expect(matrix).toEqual([
      ['K', 'V'],
      ['shared', 'a'],
      // Row 2 col 0 is occupied by the rowspan; later cells skip it.
      ['', 'b'],
    ]);
  });

  it('parses a headerless table (all td)', () => {
    const matrix = parseTableMatrix(
      table(
        '<table><tbody><tr><td>x</td><td>y</td></tr>' +
          '<tr><td>1</td><td>2</td></tr></tbody></table>',
      ),
    );
    expect(matrix).toEqual([
      ['x', 'y'],
      ['1', '2'],
    ]);
  });

  it('returns [] for an empty table', () => {
    expect(parseTableMatrix(table('<table></table>'))).toEqual([]);
  });

  it('pads ragged rows to the max column count', () => {
    const matrix = parseTableMatrix(
      table(
        '<table><tbody>' +
          '<tr><td>a</td><td>b</td><td>c</td></tr>' +
          '<tr><td>d</td></tr>' +
          '</tbody></table>',
      ),
    );
    expect(matrix).toEqual([
      ['a', 'b', 'c'],
      ['d', '', ''],
    ]);
  });

  it('treats rowspan="0" and invalid colspan as 1 (HTML rule)', () => {
    const matrix = parseTableMatrix(
      table(
        '<table><tbody>' +
          '<tr><td rowspan="0">r</td><td colspan="garbage">c</td></tr>' +
          '<tr><td>x</td><td>y</td></tr>' +
          '</tbody></table>',
      ),
    );
    expect(matrix).toEqual([
      ['r', 'c'],
      ['x', 'y'],
    ]);
  });

  it('walks direct <tr> children of <table> (no thead/tbody wrapper)', () => {
    const matrix = parseTableMatrix(
      table(
        '<table><tr><th>H</th></tr><tr><td>D</td></tr></table>',
      ),
    );
    expect(matrix).toEqual([['H'], ['D']]);
  });

  it('collapses interior whitespace in cell text', () => {
    const matrix = parseTableMatrix(
      table(
        '<table><tbody><tr><td>  hello\n  world  </td></tr></tbody></table>',
      ),
    );
    expect(matrix).toEqual([['hello world']]);
  });

  it('strips badge and aria-label chrome from a label cell', () => {
    const matrix = parseTableMatrix(
      table(
        '<table><tbody><tr>' +
          '<td><span>Market Capitalization</span>' +
          '<span class="badge">Market Leader</span>' +
          '<span aria-label="x">Unavailable</span></td>' +
          '<td>1.2T</td>' +
          '</tr></tbody></table>',
      ),
    );
    expect(matrix).toEqual([['Market Capitalization', '1.2T']]);
  });

  it('strips data-tooltip and .tooltip chrome', () => {
    const matrix = parseTableMatrix(
      table(
        '<table><tbody><tr>' +
          '<td><span>P/E Ratio</span>' +
          '<span data-tooltip="help">i</span>' +
          '<span class="tooltip">extra</span></td>' +
          '<td>24.5</td>' +
          '</tr></tbody></table>',
      ),
    );
    expect(matrix).toEqual([['P/E Ratio', '24.5']]);
  });

  it('leaves a plain cell with no chrome unchanged', () => {
    const matrix = parseTableMatrix(
      table(
        '<table><tbody><tr><td>Plain Value</td><td>42</td></tr></tbody></table>',
      ),
    );
    expect(matrix).toEqual([['Plain Value', '42']]);
  });

  it('does not over-strip cells whose real text contains punctuation', () => {
    const matrix = parseTableMatrix(
      table(
        '<table><tbody><tr><td>+15.3%</td><td>(N/A)</td></tr></tbody></table>',
      ),
    );
    expect(matrix).toEqual([['+15.3%', '(N/A)']]);
  });

  it('does not mutate the live DOM when stripping chrome', () => {
    const { document } = buildDocument(
      '<html><body><table><tbody><tr>' +
        '<td><span>Label</span><span class="badge">B</span></td>' +
        '</tr></tbody></table></body></html>',
    );
    const el = document.querySelector('table')!;
    const cell = el.querySelector('td')!;
    expect(cell.querySelectorAll('.badge')).toHaveLength(1);
    parseTableMatrix(el);
    // The clone-based strip must not have touched the original cell.
    expect(cell.querySelectorAll('.badge')).toHaveLength(1);
  });

  it('keeps a value whose only text lives inside a badge or aria element', () => {
    // A badge/aria node that is the cell's sole text is data, not chrome —
    // stripping it would empty the cell, so the guard falls back to the raw text.
    const matrix = parseTableMatrix(
      table(
        '<table><tbody><tr>' +
          '<td><span class="badge">5</span></td>' +
          '<td><span aria-label="count">12</span></td>' +
          '</tr></tbody></table>',
      ),
    );
    expect(matrix).toEqual([['5', '12']]);
  });

  it('keeps primary text nested inside a tooltip-wrapping span', () => {
    // The visible word is the cell's entire content but sits inside the span
    // that carries data-tooltip; the never-empty guard restores it.
    const matrix = parseTableMatrix(
      table(
        '<table><tbody><tr>' +
          '<td><span class="text-capitalize" data-tooltip="tooltip" data-original-title="promoters">' +
          '<span class="text-capitalize">promoters</span></span></td>' +
          '</tr></tbody></table>',
      ),
    );
    expect(matrix).toEqual([['promoters']]);
  });

  it('surfaces an icon-only link cell as its href', () => {
    // No visible text — the URL lives in href and is the cell's only data.
    const matrix = parseTableMatrix(
      table(
        '<table><tbody><tr>' +
          '<td><a target="_blank" href="https://www.bseindia.com/r.pdf">' +
          '<span data-tooltip="tooltip" data-original-title="View Report">' +
          '<svg aria-hidden="true" viewBox="0 0 16 16"><path d="M0 0"/></svg>' +
          '</span></a></td>' +
          '</tr></tbody></table>',
      ),
    );
    expect(matrix).toEqual([['https://www.bseindia.com/r.pdf']]);
  });
});

describe('policy.tables renderTableCsv', () => {
  it('joins rows with commas and LF endings', () => {
    const matrix = [
      ['a', 'b'],
      ['1', '2'],
    ];
    expect(renderTableCsv(matrix)).toBe('a,b\n1,2');
  });

  it('quotes a field containing a comma', () => {
    expect(renderTableCsv([['hello, world', 'x']])).toBe('"hello, world",x');
  });

  it('doubles an embedded double-quote', () => {
    expect(renderTableCsv([['say "hi"']])).toBe('"say ""hi"""');
  });

  it('quotes a field containing a newline', () => {
    expect(renderTableCsv([['line1\nline2']])).toBe('"line1\nline2"');
  });

  it('returns empty string for an empty matrix', () => {
    expect(renderTableCsv([])).toBe('');
  });
});

describe('policy.tables renderTableJson', () => {
  it('keys data rows by the header row', () => {
    const matrix = [
      ['Name', 'Age'],
      ['Alice', '30'],
      ['Bob', '25'],
    ];
    expect(JSON.parse(renderTableJson(matrix))).toEqual([
      { Age: '30', Name: 'Alice' },
      { Age: '25', Name: 'Bob' },
    ]);
  });

  it('falls back to column_N for empty header cells', () => {
    const matrix = [
      ['', 'City'],
      ['Alice', 'NYC'],
    ];
    expect(JSON.parse(renderTableJson(matrix))).toEqual([
      { City: 'NYC', column_0: 'Alice' },
    ]);
  });

  it('returns [] when there is no data row', () => {
    expect(renderTableJson([['Header']])).toBe('[]');
    expect(renderTableJson([])).toBe('[]');
  });

  it('pretty-prints with a 2-space indent', () => {
    const out = renderTableJson([
      ['K'],
      ['v'],
    ]);
    // JSON.stringify(records, null, 2) → array bracket at col 0, record braces at col 2.
    expect(out).toContain('[\n  {');
    expect(out).toContain('\n    "K": "v"');
  });
});

describe('policy.tables renderTableGfm', () => {
  it('emits a header row, delimiter, then data rows', () => {
    const matrix = [
      ['A', 'B'],
      ['1', '2'],
    ];
    expect(renderTableGfm(matrix)).toBe('| A | B |\n| --- | --- |\n| 1 | 2 |');
  });

  it('inserts one delimiter column per header column', () => {
    const out = renderTableGfm([
      ['H1', 'H2', 'H3'],
      ['a', 'b', 'c'],
    ]);
    expect(out.split('\n')[1]).toBe('| --- | --- | --- |');
  });

  it('escapes an embedded pipe', () => {
    expect(renderTableGfm([['a|b']])).toBe('| a\\|b |\n| --- |');
  });

  it('escapes an embedded backslash', () => {
    expect(renderTableGfm([['a\\b']])).toBe('| a\\\\b |\n| --- |');
  });

  it('returns empty string for an empty matrix', () => {
    expect(renderTableGfm([])).toBe('');
  });

  it('emits header + delimiter only when there is no data row', () => {
    expect(renderTableGfm([['Only']])).toBe('| Only |\n| --- |');
  });
});

describe('policy.tables renderTable dispatch', () => {
  const matrix = [
    ['K', 'V'],
    ['a', '1'],
  ];

  it('dispatches to the CSV renderer', () => {
    expect(renderTable(matrix, 'csv')).toBe(renderTableCsv(matrix));
  });

  it('dispatches to the GFM renderer', () => {
    expect(renderTable(matrix, 'gfm')).toBe(renderTableGfm(matrix));
  });

  it('dispatches to the JSON renderer', () => {
    expect(renderTable(matrix, 'json')).toBe(renderTableJson(matrix));
  });
});

describe('policy.tables three formats from one matrix', () => {
  // The same rowspan/colspan-degenerate table should render coherently in all
  // three formats — the IR is the single source of truth.
  const html =
    '<table><thead>' +
    '<tr><th colspan="2">Person</th><th rowspan="2">Notes</th></tr>' +
    '<tr><th>Name</th><th>Age</th></tr>' +
    '</thead><tbody>' +
    '<tr><td>Alice</td><td>30</td><td>hello, world</td></tr>' +
    '<tr><td>Bob</td><td>25</td><td>"quoted"</td></tr>' +
    '</tbody></table>';

  it('produces a stable matrix with colspan + rowspan resolved', () => {
    expect(parseTableMatrix(table(html))).toEqual([
      ['Person', '', 'Notes'],
      ['Name', 'Age', ''],
      ['Alice', '30', 'hello, world'],
      ['Bob', '25', '"quoted"'],
    ]);
  });

  it('csv quotes the cells that need it', () => {
    const csv = renderTableCsv(parseTableMatrix(table(html)));
    // Comma in "hello, world" forces quoting; embedded quote in "quoted" doubles.
    expect(csv).toContain('"hello, world"');
    expect(csv).toContain('"""quoted"""');
  });

  it('gfm emits a delimiter row matching the header width (3 cols)', () => {
    const gfm = renderTableGfm(parseTableMatrix(table(html)));
    expect(gfm.split('\n')[1]).toBe('| --- | --- | --- |');
  });

  it('json keys data rows by the first header row', () => {
    const json = renderTableJson(parseTableMatrix(table(html)));
    const records = JSON.parse(json) as Record<string, string>[];
    // The matrix has 4 rows: row 0 (Person/Notes) is the JSON header; rows 1-3
    // are data records, including the second HTML header row (Name/Age), which
    // the row-0-keyed IR cannot distinguish from data.
    expect(records).toHaveLength(3);
    expect(records[0]).toMatchObject({
      Person: 'Name',
      column_1: 'Age',
      Notes: '',
    });
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
});

describe('policy.tables resolveHeaderKeys', () => {
  it('reproduces header text for a simple headered table', () => {
    const t = table(
      '<table><thead><tr><th>A</th><th>B</th></tr></thead>' +
        '<tbody><tr><td>1</td><td>2</td></tr></tbody></table>',
    );
    expect(resolveHeaderKeys(t, parseTableMatrix(t))).toEqual(['A', 'B']);
  });

  it('keeps column_N when no structural signal exists', () => {
    // Mirrors the MoneyControl bid/ask shape: th, gap, th, gap — no colspan,
    // no aria-label. The honest structural answer is still column_N.
    const t = table(
      '<table><thead><tr><th>BUY</th><th></th><th>SELL</th><th></th></tr></thead>' +
        '<tbody><tr><td>1</td><td>2</td><td>3</td><td>4</td></tr></tbody></table>',
    );
    expect(resolveHeaderKeys(t, parseTableMatrix(t))).toEqual([
      'BUY',
      'column_1',
      'SELL',
      'column_3',
    ]);
  });

  it('uses aria-label from the first data-row cell', () => {
    const t = table(
      '<table><thead><tr><th>BUY</th><th></th></tr></thead>' +
        '<tbody><tr><td>100</td><td aria-label="Price">5</td></tr></tbody></table>',
    );
    expect(resolveHeaderKeys(t, parseTableMatrix(t))).toEqual(['BUY', 'Price']);
  });

  it('uses title then data-label when aria-label is absent', () => {
    const t = table(
      '<table><thead><tr><th></th><th></th></tr></thead>' +
        '<tbody><tr><td title="X">1</td><td data-label="Y">2</td></tr></tbody></table>',
    );
    expect(resolveHeaderKeys(t, parseTableMatrix(t))).toEqual(['X', 'Y']);
  });

  it('pairs a colspan parent with a second header row', () => {
    const t = table(
      '<table><thead>' +
        '<tr><th colspan="2">BUY</th><th colspan="2">SELL</th></tr>' +
        '<tr><th>Price</th><th>Qty</th><th>Price</th><th>Qty</th></tr>' +
        '</thead><tbody><tr><td>1</td><td>2</td><td>3</td><td>4</td></tr></tbody></table>',
    );
    expect(resolveHeaderKeys(t, parseTableMatrix(t))).toEqual([
      'buy_price',
      'buy_qty',
      'sell_price',
      'sell_qty',
    ]);
  });

  it('pairs a colspan parent with a second header row (rowspan-occupied cells in the sub-row)', () => {
    // Notes spans both header rows; its column has no sub-label and keeps the
    // parent text. Person spans two columns; sub-row supplies Name/Age.
    const t = table(
      '<table><thead>' +
        '<tr><th colspan="2">Person</th><th rowspan="2">Notes</th></tr>' +
        '<tr><th>Name</th><th>Age</th></tr>' +
        '</thead><tbody><tr><td>a</td><td>1</td><td>n</td></tr></tbody></table>',
    );
    expect(resolveHeaderKeys(t, parseTableMatrix(t))).toEqual([
      'person_name',
      'person_age',
      'Notes',
    ]);
  });

  it('falls back to parent_index when a colspan covers a headerless column with no sub-row', () => {
    // No second header row; origin keeps its text, the headerless sibling is
    // named by its 1-based position under the parent.
    const t = table(
      '<table><thead><tr><th colspan="2">BUY</th></tr></thead>' +
        '<tbody><tr><td>1</td><td>2</td></tr></tbody></table>',
    );
    expect(resolveHeaderKeys(t, parseTableMatrix(t))).toEqual(['BUY', 'buy_2']);
  });

  it('slugifies parent and sub labels', () => {
    const t = table(
      '<table><thead>' +
        '<tr><th colspan="2">Order Type!</th></tr>' +
        '<tr><th>Unit Price</th><th>Qty.</th></tr>' +
        '</thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>',
    );
    expect(resolveHeaderKeys(t, parseTableMatrix(t))).toEqual([
      'order_type_unit_price',
      'order_type_qty',
    ]);
  });

  it('prefers a td aria-label over colspan pairing', () => {
    // No sub-header row, so matrix row 1 is the data row carrying aria-label;
    // without that label col 1 would fall through to buy_2.
    const t = table(
      '<table><thead><tr><th colspan="2">BUY</th></tr></thead>' +
        '<tbody><tr><td>1</td><td aria-label="Size">2</td></tr></tbody></table>',
    );
    expect(resolveHeaderKeys(t, parseTableMatrix(t))).toEqual(['BUY', 'Size']);
  });

  it('returns [] for an empty matrix', () => {
    const t = table('<table></table>');
    expect(resolveHeaderKeys(t, parseTableMatrix(t))).toEqual([]);
  });
});

describe('policy.tables renderTableJson with keys', () => {
  it('honours caller-supplied keys', () => {
    const matrix = [
      ['', ''],
      ['Alice', '30'],
    ];
    const json = renderTableJson(matrix, ['Name', 'Age']);
    expect(JSON.parse(json)).toEqual([{ Name: 'Alice', Age: '30' }]);
  });

  it('pads short keys with column_N and ignores extra keys', () => {
    const matrix = [
      ['', '', ''],
      ['a', 'b', 'c'],
    ];
    const json = renderTableJson(matrix, ['Only']);
    expect(JSON.parse(json)).toEqual([
      { Only: 'a', column_1: 'b', column_2: 'c' },
    ]);
  });

  it('falls back to headerKeys when keys is omitted', () => {
    const matrix = [
      ['', 'City'],
      ['Alice', 'NYC'],
    ];
    expect(JSON.parse(renderTableJson(matrix))).toEqual([
      { column_0: 'Alice', City: 'NYC' },
    ]);
  });
});

describe('policy.tables renderTable passes keys to json only', () => {
  const matrix = [
    ['', ''],
    ['a', 'b'],
  ];
  const keys = ['Alpha', 'Beta'];

  it('threads keys through to json', () => {
    expect(renderTable(matrix, 'json', keys)).toBe(
      renderTableJson(matrix, keys),
    );
  });

  it('ignores keys for gfm (positional)', () => {
    expect(renderTable(matrix, 'gfm', keys)).toBe(renderTableGfm(matrix));
  });

  it('ignores keys for csv (positional)', () => {
    expect(renderTable(matrix, 'csv', keys)).toBe(renderTableCsv(matrix));
  });
});
