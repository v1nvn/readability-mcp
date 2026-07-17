import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { unifiedDiff } from './diff.js';
import { BENCH_FIXTURES, resolveFixturePath } from './fixtures.js';
import { sampleExtraction, type FixtureMetrics } from './metrics.js';

const here = dirname(fileURLToPath(import.meta.url));
const baselineDir = join(here, 'baseline');
const metricsPath = join(baselineDir, 'metrics.json');

interface FixtureReport {
  readonly category: string;
  readonly delta: string;
  readonly id: string;
  readonly metrics: FixtureMetrics;
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

function serializeMetrics(obj: Record<string, FixtureMetrics>): string {
  const sorted: Record<string, FixtureMetrics> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = obj[key];
  }
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

function updateBaselines(): void {
  mkdirSync(baselineDir, { recursive: true });
  const all: Record<string, FixtureMetrics> = {};
  for (const fixture of BENCH_FIXTURES) {
    const html = readFileSync(resolveFixturePath(fixture), 'utf8');
    const { markdown, metrics } = sampleExtraction(html, fixture.url);
    writeFileSync(join(baselineDir, `${fixture.id}.md`), markdown);
    all[fixture.id] = metrics;
  }
  writeFileSync(metricsPath, serializeMetrics(all));
  console.log(`Updated ${BENCH_FIXTURES.length} baselines under ${baselineDir}`);
}

function printReport(reports: readonly FixtureReport[]): void {
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

function run(): void {
  if (process.env.BENCH_UPDATE === '1') {
    updateBaselines();
    return;
  }

  const baseline = readMetricsBaseline();
  const reports: FixtureReport[] = [];
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
  }
  printReport(reports);
}

run();
