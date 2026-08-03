import { isElement } from '../pipeline/dom.js';
import {
  CONTAINER_TAGS,
  describeSelector,
  shapeKey,
  stripLandmarkChrome,
} from './sibling-scan.js';

export interface GridRow {
  readonly cells: readonly string[];
}

export type GridConfidence = 'high' | 'low' | 'medium';

export interface GridDetectionResult {
  readonly colCount: number;
  readonly confidence: GridConfidence;
  readonly containerSelector: string;
  readonly detected: boolean;
  readonly note: string;
  readonly rowCount: number;
  readonly rows: readonly GridRow[];
  readonly rowTag: string;
}

export interface DetectGridOptions {
  readonly cellSelector?: string;
  readonly minRows?: number;
  readonly rowSelector?: string;
}

const MIN_ROWS = 3;
const HIGH_CONF_ROWS = 6;
const MIN_CELLS_PER_ROW = 2;

function cellText(cell: Element): string {
  return cell.textContent.replace(/\s+/g, ' ').trim();
}

function rowCells(row: Element): string[] {
  return Array.from(row.children).map(cellText);
}

function notDetected(note: string): GridDetectionResult {
  return {
    confidence: 'low',
    containerSelector: '',
    detected: false,
    rowCount: 0,
    colCount: 0,
    rows: [],
    rowTag: '',
    note,
  };
}

// buildResult is only ever reached with rowCount >= minRows (both modes gate on
// it first), so confidence is `high` past HIGH_CONF_ROWS and `medium` otherwise.
// The `low` value comes only from notDetected().
function confidenceFor(rowCount: number): GridConfidence {
  return rowCount >= HIGH_CONF_ROWS ? 'high' : 'medium';
}

interface GridCandidate {
  readonly containerSelector: string;
  readonly memberCount: number;
  readonly rows: readonly string[][];
  readonly rowTag: string;
  readonly totalCellText: number;
}

// Pad ragged rows to the max cell width so the matrix is rectangular — the
// GFM/CSV/JSON renderers in policy/tables.ts assume a dense grid (the
// delimiter row is derived from row-0 width, so a short row would mis-align
// every column). Mirrors parseTableMatrix's dense-pad step.
function buildResult(
  raggedRows: readonly string[][],
  rowTag: string,
  containerSelector: string,
  selectorHint?: string,
): GridDetectionResult {
  let maxCols = 0;
  for (const row of raggedRows) {
    if (row.length > maxCols) {
      maxCols = row.length;
    }
  }
  if (maxCols === 0) {
    return notDetected(
      selectorHint
        ? `not a grid: rows matched ${selectorHint} but no cells were found`
        : 'not a grid: rows matched but no cells were found',
    );
  }
  const rowCount = raggedRows.length;
  const rows: GridRow[] = raggedRows.map(row => ({
    cells: Array.from({ length: maxCols }, (_, i) => row[i] ?? ''),
  }));
  const where = containerSelector || selectorHint || 'document';
  return {
    confidence: confidenceFor(rowCount),
    containerSelector,
    detected: true,
    rowCount,
    colCount: maxCols,
    rows,
    rowTag,
    note: `detected ${rowCount} ${rowTag} rows (${maxCols} cols) in ${where}`,
  };
}

function detectSelectorMode(
  document: Document,
  rowSelector: string,
  cellSelector: string,
  minRows: number,
): GridDetectionResult {
  const rowEls = Array.from(document.querySelectorAll(rowSelector));
  if (rowEls.length < minRows) {
    return notDetected(
      `not a grid: rowSelector "${rowSelector}" matched ${rowEls.length} row(s) (min ${minRows})`,
    );
  }
  const rows = rowEls.map(row =>
    Array.from(row.querySelectorAll(cellSelector)).map(cellText),
  );
  return buildResult(rows, rowEls[0].tagName, '', rowSelector);
}

function detectAuto(document: Document, minRows: number): GridDetectionResult {
  stripLandmarkChrome(document);

  const candidates: GridCandidate[] = [];
  for (const container of document.querySelectorAll('*')) {
    if (!CONTAINER_TAGS.has(container.tagName)) {
      continue;
    }
    // Group direct element-children by shape so a homogeneous row cluster
    // surfaces as one candidate and mixed-shape siblings (header row vs data
    // rows) split apart rather than blending into a ragged group.
    const groups = new Map<string, Element[]>();
    for (const child of Array.from(container.childNodes)) {
      if (!isElement(child)) {
        continue;
      }
      const key = shapeKey(child);
      const bucket = groups.get(key);
      if (bucket) {
        bucket.push(child);
      } else {
        groups.set(key, [child]);
      }
    }
    for (const members of groups.values()) {
      if (members.length < minRows) {
        continue;
      }
      // A row needs at least two cells to be a row; a group of single-child
      // wrappers is a list of links/labels, not a data grid.
      if (!members.every(m => m.children.length >= MIN_CELLS_PER_ROW)) {
        continue;
      }
      const rows = members.map(rowCells);
      const totalCellText = rows.reduce(
        (sum, row) => sum + row.reduce((s, c) => s + c.length, 0),
        0,
      );
      candidates.push({
        containerSelector: describeSelector(container),
        rows,
        rowTag: members[0].tagName,
        memberCount: members.length,
        totalCellText,
      });
    }
  }

  if (candidates.length === 0) {
    return notDetected(
      'not a grid: no repeating row structure (≥3 same-shape siblings each with ≥2 direct element-children, outside nav/header/footer/aside)',
    );
  }

  // Most rows wins; ties break on total cell text so a sparse 6-row grid beats
  // a dense 6-row one only when it carries more substance, and a longer
  // analyst-estimates table beats a stub sidebar mini-grid on both axes.
  let winner = candidates[0];
  for (let i = 1; i < candidates.length; i++) {
    const candidate = candidates[i];
    if (
      candidate.memberCount > winner.memberCount ||
      (candidate.memberCount === winner.memberCount &&
        candidate.totalCellText > winner.totalCellText)
    ) {
      winner = candidate;
    }
  }
  return buildResult(winner.rows, winner.rowTag, winner.containerSelector);
}

// Detect a CSS-grid/div "table" — the div equivalent of extract_tables. In
// selector mode (both rowSelector and cellSelector given) the rows and cells
// are whatever the caller names. In auto mode, chrome is stripped first and
// the container whose direct children form the largest same-shape sibling
// group (each member a row of ≥2 direct element-children) wins. The resulting
// rows are padded to a dense rectangular matrix so the shared table renderer
// can serialize them as gfm/csv/json.
export function detectGrid(
  document: Document,
  opts?: DetectGridOptions,
): GridDetectionResult {
  const minRows = opts?.minRows ?? MIN_ROWS;
  if (opts?.rowSelector && opts.cellSelector) {
    return detectSelectorMode(
      document,
      opts.rowSelector,
      opts.cellSelector,
      minRows,
    );
  }
  return detectAuto(document, minRows);
}
