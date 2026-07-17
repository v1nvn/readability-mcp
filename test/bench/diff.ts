interface Op {
  readonly kind: ' ' | '-' | '+';
  readonly text: string;
}

// Longest-common-subsequence backtrack over the two line arrays; emits a flat
// op stream of kept (' '), removed ('-'), and added ('+') lines.
function lcsOps(a: readonly string[], b: readonly string[]): Op[] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      ops.push({ kind: ' ', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ kind: '-', text: a[i++] });
    } else {
      ops.push({ kind: '+', text: b[j++] });
    }
  }
  while (i < m) ops.push({ kind: '-', text: a[i++] });
  while (j < n) ops.push({ kind: '+', text: b[j++] });
  return ops;
}

const CONTEXT = 3;

export function unifiedDiff(before: string, after: string): string {
  const ops = lcsOps(before.split('\n'), after.split('\n'));
  if (ops.every(op => op.kind === ' ')) return '';

  const ranges: Array<[number, number]> = [];
  for (let k = 0; k < ops.length; k++) {
    if (ops[k].kind === ' ') {
      continue;
    }
    const start = Math.max(0, k - CONTEXT);
    const end = Math.min(ops.length - 1, k + CONTEXT);
    const last = ranges[ranges.length - 1];
    if (last && start <= last[1] + 1) {
      last[1] = Math.max(last[1], end);
    } else {
      ranges.push([start, end]);
    }
  }

  let out = '';
  for (const [s, e] of ranges) {
    const hunk = ops.slice(s, e + 1);
    let aBefore = 0;
    let bBefore = 0;
    for (let k = 0; k < s; k++) {
      if (ops[k].kind !== '+') aBefore++;
      if (ops[k].kind !== '-') bBefore++;
    }
    let aLen = 0;
    let bLen = 0;
    for (const op of hunk) {
      if (op.kind !== '+') aLen++;
      if (op.kind !== '-') bLen++;
    }
    const aStart = aLen === 0 ? aBefore : aBefore + 1;
    const bStart = bLen === 0 ? bBefore : bBefore + 1;
    out += `@@ -${aStart},${aLen} +${bStart},${bLen} @@\n`;
    for (const op of hunk) {
      out += `${op.kind}${op.text}\n`;
    }
  }
  return out;
}
