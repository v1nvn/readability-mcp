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
