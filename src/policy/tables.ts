import { resolveCellText } from './cell-text.js';

export type TableFormat = 'csv' | 'gfm' | 'json';

// `<thead>`/`<tbody>`/`<tfoot>` group `<tr>` rows; a `<table>` may also hold `<tr>`
// directly. Walking these levels (and only these) keeps nested `<table>`s out of
// the matrix — those are emitted as their own replacement by turndown.
const SECTION_TAGS = new Set(['TBODY', 'TFOOT', 'THEAD']);
const CELL_TAGS = new Set(['TD', 'TH']);

function spanOf(cell: Element, attr: 'colspan' | 'rowspan'): number {
  const raw = cell.getAttribute(attr);
  if (raw === null) {
    return 1;
  }
  const parsed = Number.parseInt(raw, 10);
  // HTML treats 0 (and any non-positive / unparseable value) as 1.
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1;
  }
  return parsed;
}

function collectRows(table: Element): readonly Element[] {
  const rows: Element[] = [];
  for (const child of Array.from(table.children)) {
    if (child.tagName === 'TR') {
      rows.push(child);
    } else if (SECTION_TAGS.has(child.tagName)) {
      for (const tr of Array.from(child.children)) {
        if (tr.tagName === 'TR') {
          rows.push(tr);
        }
      }
    }
  }
  return rows;
}

function cellsOf(tr: Element): readonly Element[] {
  return Array.from(tr.children).filter(child => CELL_TAGS.has(child.tagName));
}

// Text projection of buildCellGrid: origin cells → resolveCellText, span/pad slots → ''.
export function parseTableMatrix(table: Element): string[][] {
  return buildCellGrid(table).map(row =>
    row.map(cell => (cell === null ? '' : resolveCellText(cell))),
  );
}

function escapeGfmCell(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
}

export function renderTableGfm(matrix: string[][]): string {
  if (matrix.length === 0) {
    return '';
  }
  const cols = matrix[0].length;
  const lines: string[] = [];
  lines.push(`| ${matrix[0].map(escapeGfmCell).join(' | ')} |`);
  lines.push(`| ${Array.from({ length: cols }, () => '---').join(' | ')} |`);
  for (let r = 1; r < matrix.length; r++) {
    lines.push(`| ${matrix[r].map(escapeGfmCell).join(' | ')} |`);
  }
  return lines.join('\n');
}

function escapeCsvField(text: string): string {
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function renderTableCsv(matrix: string[][]): string {
  if (matrix.length === 0) {
    return '';
  }
  return matrix.map(row => row.map(escapeCsvField).join(',')).join('\n');
}

function headerKeys(header: readonly string[]): string[] {
  return header.map((cell, i) => (cell === '' ? `column_${i}` : cell));
}

// Tracks the originating cell element at each grid position after resolving
// rowspan/colspan, so resolveHeaderKeys can read td/th attributes the text
// matrix discards. parseTableMatrix is the text projection of this grid; `null`
// marks positions filled by a span (no origin cell).
function buildCellGrid(table: Element): (Element | null)[][] {
  const rows = collectRows(table);
  if (rows.length === 0) {
    return [];
  }
  const grid: (Element | null)[][] = [];
  const occupied: boolean[][] = [];
  let maxCols = 0;

  for (let r = 0; r < rows.length; r++) {
    while (grid.length <= r) {
      grid.push([]);
      occupied.push([]);
    }
    const rowCells = grid[r];
    const rowOccupied = occupied[r];

    let col = 0;
    for (const cell of cellsOf(rows[r])) {
      while (rowOccupied[col]) {
        col++;
      }
      const rowspan = spanOf(cell, 'rowspan');
      const colspan = spanOf(cell, 'colspan');
      rowCells[col] = cell;
      rowOccupied[col] = true;
      for (let dr = 0; dr < rowspan; dr++) {
        for (let dc = 0; dc < colspan; dc++) {
          if (dr === 0 && dc === 0) {
            continue;
          }
          const rr = r + dr;
          while (grid.length <= rr) {
            grid.push([]);
            occupied.push([]);
          }
          const occ = occupied[rr];
          while (occ.length <= col + dc) {
            occ.push(false);
            grid[rr].push(null);
          }
          occ[col + dc] = true;
        }
      }
      col += colspan;
      if (col > maxCols) {
        maxCols = col;
      }
    }
  }

  const dense: (Element | null)[][] = [];
  for (const row of grid) {
    dense.push(Array.from({ length: maxCols }, (_, i) => row[i] ?? null));
  }
  return dense;
}

function isHeaderRow(tr: Element): boolean {
  const cells = cellsOf(tr);
  return cells.length > 0 && cells.every(c => c.tagName === 'TH');
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function readCellLabel(cell: Element): null | string {
  return (
    cell.getAttribute('aria-label') ??
    cell.getAttribute('title') ??
    cell.getAttribute('data-label')
  );
}

export function resolveHeaderKeys(
  table: Element,
  matrix: string[][],
): string[] {
  if (matrix.length === 0) {
    return [];
  }
  const width = matrix[0].length;
  const keys = headerKeys(matrix[0]);

  const rows = collectRows(table);
  if (rows.length === 0) {
    return keys;
  }

  const cellGrid = buildCellGrid(table);

  // Headerless columns lose their name without a th; recover from a colspan
  // parent in row 0, falling back to the position under that parent.
  const parents: string[] = Array.from({ length: width }, () => '');
  const parentChildren = new Map<string, number[]>();
  {
    let col = 0;
    for (const cell of cellsOf(rows[0])) {
      const colspan = spanOf(cell, 'colspan');
      const text = resolveCellText(cell);
      if (colspan > 1 && text) {
        const slug = slugify(text);
        const kids: number[] = [];
        for (let dc = 0; dc < colspan && col + dc < width; dc++) {
          parents[col + dc] = slug;
          kids.push(col + dc);
        }
        parentChildren.set(slug, kids);
      }
      col += colspan;
    }
  }

  const hasSubRow = rows.length > 1 && isHeaderRow(rows[1]);

  for (let c = 0; c < width; c++) {
    const dataCell = cellGrid[1]?.[c];
    if (dataCell) {
      const label = readCellLabel(dataCell);
      if (label) {
        keys[c] = label;
        continue;
      }
    }

    const parent = parents[c];
    if (!parent) {
      continue;
    }

    if (hasSubRow) {
      const sub = matrix[1][c] ? slugify(matrix[1][c]) : '';
      if (sub) {
        keys[c] = `${parent}_${sub}`;
        continue;
      }
    }

    if (matrix[0][c] === '') {
      const kids = parentChildren.get(parent);
      const idx = kids ? kids.indexOf(c) + 1 : c;
      keys[c] = `${parent}_${idx}`;
    }
  }
  return keys;
}

function resolveJsonKeys(
  matrix: string[][],
  keys: readonly string[] | undefined,
): string[] {
  const width = matrix[0].length;
  if (!keys) {
    return headerKeys(matrix[0]);
  }
  return Array.from({ length: width }, (_, i) => keys[i] ?? `column_${i}`);
}

export function renderTableJson(
  matrix: string[][],
  keys?: readonly string[],
): string {
  if (matrix.length < 2) {
    return '[]';
  }
  const resolved = resolveJsonKeys(matrix, keys);
  const records: Record<string, string>[] = [];
  for (let r = 1; r < matrix.length; r++) {
    const row = matrix[r];
    const record: Record<string, string> = {};
    for (let c = 0; c < resolved.length; c++) {
      record[resolved[c]] = row[c] ?? '';
    }
    records.push(record);
  }
  return JSON.stringify(records, null, 2);
}

export function renderTable(
  matrix: string[][],
  format: TableFormat,
  keys?: readonly string[],
): string {
  switch (format) {
    case 'csv':
      return renderTableCsv(matrix);
    case 'gfm':
      return renderTableGfm(matrix);
    case 'json':
      return renderTableJson(matrix, keys);
  }
}
