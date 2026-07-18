import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { unifiedDiff } from './diff.js';
import { BENCH_FIXTURES, resolveFixturePath } from './fixtures.js';
import { MAIN_CONTENT_SELECTORS } from './labels.js';
import { sampleExtraction, type FixtureMetrics } from './metrics.js';
import { scoreFixture, type FixtureScore, type PrecisionRecall } from './scorer.js';

const here = dirname(fileURLToPath(import.meta.url));
const baselineDir = join(here, 'baseline');
const metricsPath = join(baselineDir, 'metrics.json');
const scoresPath = join(baselineDir, 'scores.json');

interface FixtureReport {
  readonly category: string;
  readonly delta: string;
  readonly id: string;
  readonly metrics: FixtureMetrics;
}

interface ScoredFixture extends FixtureScore {
  readonly id: string;
}

function readMetricsBaseline(): Record<string, FixtureMetrics> {
  try {
    return JSON.parse(readFileSync(metricsPath, 'utf8')) as Record<
      string,
      FixtureMetrics
    >;
  } catch {
    return {};
  }
}

function serializeJson<T>(obj: Record<string, T>): string {
  const sorted: Record<string, T> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = obj[key];
  }
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

function updateBaselines(): void {
  mkdirSync(baselineDir, { recursive: true });
  const metrics: Record<string, FixtureMetrics> = {};
  const scores: Record<string, PrecisionRecall> = {};
  const aggregate: PrecisionRecall[] = [];
  for (const fixture of BENCH_FIXTURES) {
    const html = readFileSync(resolveFixturePath(fixture), 'utf8');
    const { markdown, metrics: m } = sampleExtraction(html, fixture.url);
    writeFileSync(join(baselineDir, `${fixture.id}.md`), markdown);
    metrics[fixture.id] = m;

    const selector = MAIN_CONTENT_SELECTORS[fixture.id];
    if (!selector) continue;
    const score = scoreFixture(html, fixture.url, selector);
    scores[fixture.id] = {
      f1: score.f1,
      precision: score.precision,
      recall: score.recall,
    };
    if (Number.isNaN(score.precision)) continue;
    aggregate.push({ f1: score.f1, precision: score.precision, recall: score.recall });
  }
  scores.aggregate = macroAverage(aggregate);
  writeFileSync(metricsPath, serializeJson(metrics));
  writeFileSync(scoresPath, serializeJson(scores));
  console.log(`Updated ${BENCH_FIXTURES.length} baselines under ${baselineDir}`);
}

function macroAverage(scores: readonly PrecisionRecall[]): PrecisionRecall {
  if (scores.length === 0) {
    return { f1: NaN, precision: NaN, recall: NaN };
  }
  const sum = scores.reduce(
    (acc, s) => ({
      f1: acc.f1 + s.f1,
      p: acc.p + s.precision,
      r: acc.r + s.recall,
    }),
    { f1: 0, p: 0, r: 0 },
  );
  const n = scores.length;
  return { f1: sum.f1 / n, precision: sum.p / n, recall: sum.r / n };
}

function round(value: number, places = 3): string {
  if (Number.isNaN(value)) return 'N/A';
  const factor = 10 ** places;
  return String(Math.round(value * factor) / factor);
}

function printMetricsTable(reports: readonly FixtureReport[]): void {
  const header = [
    'id',
    'category',
    'inputNodes',
    'markdownChars',
    'tokens',
    'compression',
    'removed',
    'images',
    'tables',
    'links',
  ];
  const rows = reports.map(r => [
    r.id,
    r.category,
    String(r.metrics.inputNodes),
    String(r.metrics.markdownChars),
    String(r.metrics.tokenEstimate),
    String(r.metrics.compressionRatio),
    String(r.metrics.removedNodes),
    String(r.metrics.images),
    String(r.metrics.tables),
    String(r.metrics.links),
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map(row => row[i].length)),
  );
  const fmt = (cells: readonly string[]): string =>
    cells.map((c, i) => c.padEnd(widths[i])).join('  ');

  console.log(fmt(header));
  console.log(widths.map(w => '-'.repeat(w)).join('  '));
  for (const row of rows) {
    console.log(fmt(row));
  }

  const withDelta = reports.filter(r => r.delta.length > 0);
  for (const r of withDelta) {
    console.log(`\n--- fixture: ${r.id} ---`);
    process.stdout.write(r.delta);
  }

  const totalChars = reports.reduce((s, r) => s + r.metrics.markdownChars, 0);
  const totalTokens = reports.reduce((s, r) => s + r.metrics.tokenEstimate, 0);
  console.log(
    `\n${reports.length} fixtures · ${withDelta.length} with content deltas · ${totalChars} markdown chars · ${totalTokens} tokens`,
  );
}

function printScoresTable(scores: readonly ScoredFixture[]): void {
  const header = [
    'id',
    'precision',
    'recall',
    'f1',
    'extractedTokens',
    'labeledTokens',
  ];
  const rows = scores.map(s => [
    s.id,
    round(s.precision),
    round(s.recall),
    round(s.f1),
    String(s.extractedTokens),
    String(s.labeledTokens),
  ]);
  const scored = scores.filter(s => !Number.isNaN(s.precision));
  const agg = macroAverage(scored);
  rows.push([
    'aggregate',
    round(agg.precision),
    round(agg.recall),
    round(agg.f1),
    String(scored.reduce((sum, s) => sum + s.extractedTokens, 0)),
    String(scored.reduce((sum, s) => sum + s.labeledTokens, 0)),
  ]);

  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map(row => row[i].length)),
  );
  const fmt = (cells: readonly string[]): string =>
    cells.map((c, i) => c.padEnd(widths[i])).join('  ');

  console.log('\nprecision/recall vs human-labeled main content');
  console.log(fmt(header));
  console.log(widths.map(w => '-'.repeat(w)).join('  '));
  for (let i = 0; i < rows.length; i++) {
    console.log(fmt(rows[i]));
    if (i === rows.length - 2) {
      console.log(widths.map(w => '-'.repeat(w)).join('  '));
    }
  }
}

function printStageTimings(scores: readonly FixtureScore[]): void {
  const totals = new Map<string, { ms: number; count: number }>();
  for (const s of scores) {
    for (const entry of s.trace) {
      const prev = totals.get(entry.stage) ?? { count: 0, ms: 0 };
      totals.set(entry.stage, {
        count: prev.count + 1,
        ms: prev.ms + entry.ms,
      });
    }
  }
  if (totals.size === 0) return;

  const header = ['stage', 'avgMs', 'samples'];
  const rows = [...totals.entries()]
    .map(([stage, t]) => [stage, round(t.ms / t.count, 3), String(t.count)])
    .sort((a, b) => a[0].localeCompare(b[0]));
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map(row => row[i].length)),
  );
  const fmt = (cells: readonly string[]): string =>
    cells.map((c, i) => c.padEnd(widths[i])).join('  ');

  console.log('\naggregate per-stage timings (debug trace)');
  console.log(fmt(header));
  console.log(widths.map(w => '-'.repeat(w)).join('  '));
  for (const row of rows) {
    console.log(fmt(row));
  }
}

function run(): void {
  if (process.env.BENCH_UPDATE === '1') {
    updateBaselines();
    return;
  }

  const baseline = readMetricsBaseline();
  const reports: FixtureReport[] = [];
  const scores: ScoredFixture[] = [];
  for (const fixture of BENCH_FIXTURES) {
    const html = readFileSync(resolveFixturePath(fixture), 'utf8');
    const { markdown, metrics } = sampleExtraction(html, fixture.url);
    let delta = '';
    try {
      const baselineMd = readFileSync(
        join(baselineDir, `${fixture.id}.md`),
        'utf8',
      );
      delta = unifiedDiff(baselineMd, markdown);
    } catch {
      delta = '';
    }
    reports.push({ category: fixture.category, delta, id: fixture.id, metrics });
    if (!(fixture.id in baseline)) {
      console.warn(
        `warning: no metrics baseline for ${fixture.id}; run BENCH_UPDATE=1`,
      );
    }

    const selector = MAIN_CONTENT_SELECTORS[fixture.id];
    if (!selector) continue;
    scores.push({ ...scoreFixture(html, fixture.url, selector), id: fixture.id });
  }
  printMetricsTable(reports);
  printScoresTable(scores);
  printStageTimings(scores);
}

run();
