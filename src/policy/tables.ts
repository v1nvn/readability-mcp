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

function cellText(cell: Element): string {
  return cell.textContent.replace(/\s+/g, ' ').trim();
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

export function parseTableMatrix(table: Element): string[][] {
  const rows = collectRows(table);
  if (rows.length === 0) {
    return [];
  }

  const grid: string[][] = [];
  // Sparse occupancy: occupied[row][col] = true. Grows as rows are appended.
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
      // Place text only at the origin; spanned cells stay empty but reserved.
      rowCells[col] = cellText(cell);
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
            grid[rr].push('');
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

  // Normalize to dense rectangular: pad short rows with ''.
  const dense: string[][] = [];
  for (const row of grid) {
    const padded = Array.from({ length: maxCols }, (_, i) => row[i] ?? '');
    dense.push(padded);
  }
  return dense;
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

export function renderTableJson(matrix: string[][]): string {
  if (matrix.length < 2) {
    return '[]';
  }
  const keys = headerKeys(matrix[0]);
  const records: Record<string, string>[] = [];
  for (let r = 1; r < matrix.length; r++) {
    const row = matrix[r];
    const record: Record<string, string> = {};
    for (let c = 0; c < keys.length; c++) {
      record[keys[c]] = row[c] ?? '';
    }
    records.push(record);
  }
  return JSON.stringify(records, null, 2);
}

export function renderTable(matrix: string[][], format: TableFormat): string {
  switch (format) {
    case 'csv':
      return renderTableCsv(matrix);
    case 'gfm':
      return renderTableGfm(matrix);
    case 'json':
      return renderTableJson(matrix);
  }
}
