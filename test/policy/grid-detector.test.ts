import { buildDocument } from '../../src/pipeline/dom.js';
import { detectGrid } from '../../src/policy/grid-detector.js';

function doc(html: string): Document {
  return buildDocument(`<html><body>${html}</body></html>`).document;
}

const GRID_HTML =
  '<div class="grid">' +
  '<div class="row"><div class="cell">A1</div><div class="cell">B1</div><div class="cell">C1</div></div>' +
  '<div class="row"><div class="cell">A2</div><div class="cell">B2</div><div class="cell">C2</div></div>' +
  '<div class="row"><div class="cell">A3</div><div class="cell">B3</div><div class="cell">C3</div></div>' +
  '<div class="row"><div class="cell">A4</div><div class="cell">B4</div><div class="cell">C4</div></div>' +
  '</div>';

describe('detectGrid: auto-detect mode', () => {
  it('detects a same-shape sibling grid and reads its cells', () => {
    const result = detectGrid(doc(GRID_HTML));
    expect(result.detected).toBe(true);
    expect(result.rowTag).toBe('DIV');
    expect(result.rowCount).toBe(4);
    expect(result.colCount).toBe(3);
    expect(result.confidence).toBe('medium');
    expect(result.rows.map(r => [...r.cells])).toEqual([
      ['A1', 'B1', 'C1'],
      ['A2', 'B2', 'C2'],
      ['A3', 'B3', 'C3'],
      ['A4', 'B4', 'C4'],
    ]);
    expect(result.containerSelector).toBe('div.grid');
  });

  it('rejects an article page with no repeating grid', () => {
    const html =
      '<article><h1>Title</h1><p>One paragraph of prose.</p>' +
      '<p>Another paragraph.</p></article>';
    const result = detectGrid(doc(html));
    expect(result.detected).toBe(false);
    expect(result.rows).toHaveLength(0);
    expect(result.rowCount).toBe(0);
    expect(result.colCount).toBe(0);
    expect(result.confidence).toBe('low');
    expect(result.note).toMatch(/not a grid/i);
  });

  it('ignores chrome containers (nav/aside) that host same-shape siblings', () => {
    // Without the chrome strip, the nav's four single-cell <li> rows could
    // look like a grid; the detector removes nav first.
    const html =
      '<nav><ul>' +
      '<li><a href="/a">A</a></li>' +
      '<li><a href="/b">B</a></li>' +
      '<li><a href="/c">C</a></li>' +
      '</ul></nav>' +
      '<div class="grid">' +
      '<div class="row"><div>a</div><div>b</div></div>' +
      '<div class="row"><div>c</div><div>d</div></div>' +
      '<div class="row"><div>e</div><div>f</div></div>' +
      '</div>';
    const result = detectGrid(doc(html));
    expect(result.detected).toBe(true);
    expect(result.rowCount).toBe(3);
    expect(result.containerSelector).toBe('div.grid');
  });

  it('pads ragged rows to a dense rectangular matrix', () => {
    // All rows carry ≥2 cells (the per-row minimum) but differ in width, so the
    // group is valid and the short row is padded up to the max width.
    const html =
      '<div class="grid">' +
      '<div class="row"><div>a</div><div>b</div><div>c</div></div>' +
      '<div class="row"><div>d</div><div>e</div></div>' +
      '<div class="row"><div>f</div><div>g</div><div>h</div></div>' +
      '</div>';
    const result = detectGrid(doc(html));
    expect(result.detected).toBe(true);
    expect(result.colCount).toBe(3);
    // Every row is padded to the max width (3); the short middle row gains ''.
    for (const row of result.rows) {
      expect(row.cells.length).toBe(3);
    }
    expect([...result.rows[1]!.cells]).toEqual(['d', 'e', '']);
  });

  it('rejects a group whose members have fewer than two cells', () => {
    // Each child has a single element child → a list of labels, not a grid.
    const html =
      '<div class="grid">' +
      '<div class="row"><span>x</span></div>' +
      '<div class="row"><span>y</span></div>' +
      '<div class="row"><span>z</span></div>' +
      '</div>';
    const result = detectGrid(doc(html));
    expect(result.detected).toBe(false);
  });

  it('picks the larger cluster when two grids compete', () => {
    const html =
      '<div class="mini">' +
      '<div class="r"><div>1</div><div>2</div></div>' +
      '<div class="r"><div>3</div><div>4</div></div>' +
      '<div class="r"><div>5</div><div>6</div></div>' +
      '</div>' +
      '<div class="big">' +
      '<div class="r"><div>a</div><div>b</div></div>' +
      '<div class="r"><div>c</div><div>d</div></div>' +
      '<div class="r"><div>e</div><div>f</div></div>' +
      '<div class="r"><div>g</div><div>h</div></div>' +
      '<div class="r"><div>i</div><div>j</div></div>' +
      '</div>';
    const result = detectGrid(doc(html));
    expect(result.detected).toBe(true);
    expect(result.rowCount).toBe(5);
    expect(result.containerSelector).toBe('div.big');
  });

  it('recovers a header row split off by an extra class token', () => {
    // The header carries an extra "est-header" class, so shapeKey splits it into
    // its own 1-member group (below minRows). Without header recovery it would
    // be dropped and the first data row mis-read as the header (rowCount 4).
    const html =
      '<div class="estimates-table">' +
      '<div class="est-row est-header">' +
      '<div class="est-cell metric">Metric</div>' +
      '<div class="est-cell">FY26E</div><div class="est-cell">FY27E</div><div class="est-cell">FY28E</div>' +
      '</div>' +
      '<div class="est-row"><div class="est-cell metric">Revenue</div><div class="est-cell">8120</div><div class="est-cell">9540</div><div class="est-cell">11210</div></div>' +
      '<div class="est-row"><div class="est-cell metric">EBITDA</div><div class="est-cell">2410</div><div class="est-cell">2840</div><div class="est-cell">3210</div></div>' +
      '<div class="est-row"><div class="est-cell metric">EPS</div><div class="est-cell">120</div><div class="est-cell">140</div><div class="est-cell">160</div></div>' +
      '<div class="est-row"><div class="est-cell metric">P/E</div><div class="est-cell">30</div><div class="est-cell">28</div><div class="est-cell">26</div></div>' +
      '</div>';
    const result = detectGrid(doc(html));
    expect(result.detected).toBe(true);
    expect(result.rowCount).toBe(5);
    expect(result.colCount).toBe(4);
    expect(result.rows.map(r => [...r.cells])).toEqual([
      ['Metric', 'FY26E', 'FY27E', 'FY28E'],
      ['Revenue', '8120', '9540', '11210'],
      ['EBITDA', '2410', '2840', '3210'],
      ['EPS', '120', '140', '160'],
      ['P/E', '30', '28', '26'],
    ]);
  });

  it('recovers a header row signalled by ARIA columnheader roles', () => {
    const html =
      '<div class="grid">' +
      '<div role="row"><div role="columnheader">A</div><div role="columnheader">B</div></div>' +
      '<div class="row"><div>1</div><div>2</div></div>' +
      '<div class="row"><div>3</div><div>4</div></div>' +
      '<div class="row"><div>5</div><div>6</div></div>' +
      '</div>';
    const result = detectGrid(doc(html));
    expect(result.detected).toBe(true);
    expect(result.rowCount).toBe(4);
    expect([...result.rows[0]!.cells]).toEqual(['A', 'B']);
  });

  it('does not promote a non-header sibling to the header slot', () => {
    // A filter row with the same column shape but no header signal must not be
    // grabbed as a header; it simply is not part of the data cluster.
    const html =
      '<div class="grid">' +
      '<div class="filter"><input/><input/></div>' +
      '<div class="row"><div>a</div><div>b</div></div>' +
      '<div class="row"><div>c</div><div>d</div></div>' +
      '<div class="row"><div>e</div><div>f</div></div>' +
      '</div>';
    const result = detectGrid(doc(html));
    expect(result.detected).toBe(true);
    expect(result.rowCount).toBe(3);
    expect([...result.rows[0]!.cells]).toEqual(['a', 'b']);
  });

  it('does not grab chrome whose class merely contains "header"', () => {
    // A control bar labelled "card-header" sits above the grid with the same
    // column count. It shares no class token with the data rows, so it is not a
    // header for this cluster and must not be promoted — substring matching on
    // "header" would wrongly grab it and mislabel every column.
    const html =
      '<div class="grid">' +
      '<div class="card-header"><div>x</div><div>y</div></div>' +
      '<div class="row"><div>a</div><div>b</div></div>' +
      '<div class="row"><div>c</div><div>d</div></div>' +
      '<div class="row"><div>e</div><div>f</div></div>' +
      '</div>';
    const result = detectGrid(doc(html));
    expect(result.detected).toBe(true);
    expect(result.rowCount).toBe(3);
    expect([...result.rows[0]!.cells]).toEqual(['a', 'b']);
  });

  it('recovers a header that shares the data row class plus a token', () => {
    // "row head" carries the data rows' "row" token plus "head" (no "header"
    // substring at all) — kinship, not spelling, is what identifies it.
    const html =
      '<div class="grid">' +
      '<div class="row head"><div>M</div><div>N</div></div>' +
      '<div class="row"><div>1</div><div>2</div></div>' +
      '<div class="row"><div>3</div><div>4</div></div>' +
      '<div class="row"><div>5</div><div>6</div></div>' +
      '</div>';
    const result = detectGrid(doc(html));
    expect(result.detected).toBe(true);
    expect(result.rowCount).toBe(4);
    expect([...result.rows[0]!.cells]).toEqual(['M', 'N']);
  });

  it('does not let a recovered header inflate confidence', () => {
    // 5 data rows + 1 recovered header = 6 emitted, but the evidence is 5 data
    // rows, so confidence stays medium (HIGH_CONF_ROWS is 6) even though
    // rowCount counts the header.
    const html =
      '<div class="grid">' +
      '<div class="row head"><div>H</div><div>H2</div></div>' +
      '<div class="row"><div>1</div><div>2</div></div>' +
      '<div class="row"><div>3</div><div>4</div></div>' +
      '<div class="row"><div>5</div><div>6</div></div>' +
      '<div class="row"><div>7</div><div>8</div></div>' +
      '<div class="row"><div>9</div><div>10</div></div>' +
      '</div>';
    const result = detectGrid(doc(html));
    expect(result.detected).toBe(true);
    expect(result.rowCount).toBe(6);
    expect(result.confidence).toBe('medium');
    expect(result.note).toMatch(/5 .*data rows plus 1 header/);
  });

  it('reports high confidence only at six or more data rows', () => {
    const rows = Array.from(
      { length: 6 },
      (_, i) => `<div class="row"><div>a${i}</div><div>b${i}</div></div>`,
    ).join('');
    const result = detectGrid(doc(`<div class="grid">${rows}</div>`));
    expect(result.confidence).toBe('high');
    expect(result.rowCount).toBe(6);
  });

  it('surfaces an icon-only link cell as its href (shared cell resolver)', () => {
    const html =
      '<div class="grid">' +
      '<div class="row"><div>Name</div>' +
      '<a href="https://example.com/r.pdf"><svg aria-hidden="true"><path d="M0 0"/></svg></a>' +
      '</div>' +
      '<div class="row"><div>Other</div>' +
      '<a href="https://example.com/s.pdf"><svg aria-hidden="true"><path d="M0 0"/></svg></a>' +
      '</div>' +
      '<div class="row"><div>Last</div>' +
      '<a href="https://example.com/t.pdf"><svg aria-hidden="true"><path d="M0 0"/></svg></a>' +
      '</div>' +
      '</div>';
    const result = detectGrid(doc(html));
    expect(result.detected).toBe(true);
    expect(result.rows.map(r => [...r.cells])).toEqual([
      ['Name', 'https://example.com/r.pdf'],
      ['Other', 'https://example.com/s.pdf'],
      ['Last', 'https://example.com/t.pdf'],
    ]);
  });
});

describe('detectGrid: selector mode', () => {
  it('reads rows and cells from explicit selectors', () => {
    const result = detectGrid(doc(GRID_HTML), {
      rowSelector: '.row',
      cellSelector: '.cell',
    });
    expect(result.detected).toBe(true);
    expect(result.rowTag).toBe('DIV');
    expect(result.rowCount).toBe(4);
    expect(result.colCount).toBe(3);
    expect(result.rows.map(r => [...r.cells])).toEqual([
      ['A1', 'B1', 'C1'],
      ['A2', 'B2', 'C2'],
      ['A3', 'B3', 'C3'],
      ['A4', 'B4', 'C4'],
    ]);
  });

  it('scopes cells to each row subtree (not the whole document)', () => {
    const html =
      '<div class="row"><div class="cell">r1a</div><div class="cell">r1b</div>' +
      '<div class="nested"><div class="cell">leak</div></div></div>' +
      '<div class="row"><div class="cell">r2a</div><div class="cell">r2b</div>' +
      '<div class="nested"><div class="cell">leak</div></div></div>' +
      '<div class="row"><div class="cell">r3a</div><div class="cell">r3b</div>' +
      '<div class="nested"><div class="cell">leak</div></div></div>';
    // querySelectorAll('.cell') on a row would descend into .nested; using the
    // row subtree still finds them because they are descendants. The contract
    // is "scoped to the row subtree", so descendants count — but the row's own
    // cells come first and the matrix still has one column per matched cell.
    const result = detectGrid(doc(html), {
      rowSelector: '.row',
      cellSelector: '.cell',
    });
    expect(result.detected).toBe(true);
    expect(result.rowCount).toBe(3);
    // Each row matches 3 cells (2 direct + 1 nested) → 3 cols.
    expect(result.colCount).toBe(3);
  });

  it('returns not-detected when rowSelector matches fewer than minRows', () => {
    const result = detectGrid(doc(GRID_HTML), {
      rowSelector: '.row',
      cellSelector: '.cell',
      minRows: 10,
    });
    expect(result.detected).toBe(false);
    expect(result.note).toMatch(/min 10/);
  });

  it('falls back to auto-detection when only one selector is given', () => {
    // detectGrid itself does not enforce both-or-neither (the schema does);
    // passing only rowSelector routes through auto mode so the detector stays
    // total over its options.
    const result = detectGrid(doc(GRID_HTML), { rowSelector: '.row' });
    expect(result.detected).toBe(true);
    expect(result.rowCount).toBe(4);
  });
});
