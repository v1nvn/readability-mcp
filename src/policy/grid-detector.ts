import { isElement } from '../pipeline/dom.js';
import { resolveCellText } from './cell-text.js';
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

function rowCells(row: Element): string[] {
  return Array.from(row.children).map(resolveCellText);
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

// Confidence tracks the detected cluster (the data-row count), not any header
// row inferred on top of it — a recovered header is inference, not evidence, so
// it must not push a grid past HIGH_CONF_ROWS. Both detection modes gate on
// minRows before reaching buildResult, so this is only ever called with a
// data-row count >= minRows; `low` comes solely from notDetected().
function confidenceFor(dataRowCount: number): GridConfidence {
  return dataRowCount >= HIGH_CONF_ROWS ? 'high' : 'medium';
}

interface GridCandidate {
  readonly container: Element;
  readonly containerSelector: string;
  readonly memberCount: number;
  readonly members: readonly Element[];
  readonly rows: readonly string[][];
  readonly rowTag: string;
  readonly totalCellText: number;
}

// Pad ragged rows to the max cell width so the matrix is rectangular — the
// GFM/CSV/JSON renderers in policy/tables.ts assume a dense grid (the
// delimiter row is derived from row-0 width, so a short row would mis-align
// every column). Mirrors parseTableMatrix's dense-pad step.
// `evidence` separates the detected cluster from the emitted matrix: rowCount
// counts every emitted row (data plus any recovered header), but confidence and
// the "detected N" note track the data-row cluster alone, since the header is
// inferred rather than detected. Omitted in selector mode and when auto-detect
// recovers no header, where the two counts coincide.
function buildResult(
  raggedRows: readonly string[][],
  rowTag: string,
  containerSelector: string,
  selectorHint?: string,
  evidence?: { readonly dataRowCount: number; readonly headerCount: number },
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
  const dataRowCount = evidence?.dataRowCount ?? rowCount;
  const headerCount = evidence?.headerCount ?? 0;
  const rows: GridRow[] = raggedRows.map(row => ({
    cells: Array.from({ length: maxCols }, (_, i) => row[i] ?? ''),
  }));
  const where = containerSelector || selectorHint || 'document';
  const descriptor =
    headerCount > 0
      ? `detected ${dataRowCount} ${rowTag} data rows plus ${headerCount} header row${headerCount > 1 ? 's' : ''} (${maxCols} cols) in ${where}`
      : `detected ${dataRowCount} ${rowTag} rows (${maxCols} cols) in ${where}`;
  return {
    confidence: confidenceFor(dataRowCount),
    containerSelector,
    detected: true,
    rowCount,
    colCount: maxCols,
    rows,
    rowTag,
    note: descriptor,
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
    Array.from(row.querySelectorAll(cellSelector)).map(resolveCellText),
  );
  return buildResult(rows, rowEls[0].tagName, '', rowSelector);
}

function modalWidth(members: readonly Element[]): number {
  const counts = new Map<number, number>();
  for (const member of members) {
    const width = member.children.length;
    counts.set(width, (counts.get(width) ?? 0) + 1);
  }
  let best = members[0].children.length;
  let bestCount = 0;
  for (const [width, count] of counts) {
    if (count > bestCount) {
      best = width;
      bestCount = count;
    }
  }
  return best;
}

function classTokens(el: Element): Set<string> {
  const cls = el.getAttribute('class');
  return cls ? new Set(cls.trim().split(/\s+/)) : new Set();
}

// A div-grid header has no <th>, so recovery leans on two signals, strongest
// first. (1) An ARIA grid header — role="row" with a columnheader child — is a
// semantic role and reliable on its own. (2) Class kinship with the data
// cluster: a real header is the data rows' own class plus a discriminator
// ("est-header"), so it carries every data class token. Chrome such as
// "card-header" / "page-header" shares no class with the data rows and must not
// be promoted — which is why we match token ownership, never the "header"
// substring. Substring matching is what split the header into its own shape
// group to begin with, and it over-fires on any chrome whose class merely
// contains the word.
function looksLikeHeader(
  child: Element,
  rowTag: string,
  dataClass: Set<string>,
  dataWidth: number,
): boolean {
  if (child.tagName !== rowTag || child.children.length !== dataWidth) {
    return false;
  }
  if (
    child.getAttribute('role') === 'row' &&
    Array.from(child.children).some(
      c => c.getAttribute('role') === 'columnheader',
    )
  ) {
    return true;
  }
  const childClass = classTokens(child);
  return (
    dataClass.size > 0 && [...dataClass].every(token => childClass.has(token))
  );
}

// A header row often carries an extra class token (e.g. "est-header") that
// splits it into its own 1-member shape group, below the minRows cutoff, so the
// data-row cluster wins on its own and the header is dropped — leaving the
// first data row mis-read as the header and the real header lost. Recover it:
// scan the winning container's children that precede the first data row and
// prepend any sibling that looks like a header for this cluster. Children after
// the first data row (totals/footer) are left alone.
function collectHeaderRows(
  container: Element,
  members: readonly Element[],
): string[][] {
  const memberSet = new Set<Element>(members);
  const rowTag = members[0].tagName;
  const dataWidth = modalWidth(members);
  // shapeKey freezes tag + class signature, so every member shares one class
  // set and members[0] represents it; child count is not part of shapeKey, so
  // widths can vary within the group (hence modalWidth above).
  const dataClass = classTokens(members[0]);
  const headers: string[][] = [];
  for (const child of Array.from(container.children)) {
    if (memberSet.has(child)) {
      break;
    }
    if (looksLikeHeader(child, rowTag, dataClass, dataWidth)) {
      headers.push(rowCells(child));
    }
  }
  return headers;
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
        container,
        containerSelector: describeSelector(container),
        members,
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
  const headerRows = collectHeaderRows(winner.container, winner.members);
  return buildResult(
    [...headerRows, ...winner.rows],
    winner.rowTag,
    winner.containerSelector,
    undefined,
    { dataRowCount: winner.memberCount, headerCount: headerRows.length },
  );
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
