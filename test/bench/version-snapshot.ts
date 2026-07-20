import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractArticleFromHtml } from '../../src/tools/extract.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesRoot = resolve(here, '../fixtures');

export interface SnapshotResult {
  readonly fixtures: readonly string[];
  readonly readabilityVersion: string;
}

// Each fixture's saved.test.ts declares its own `const pageUrl = '...'`; the
// url is origin context for link absolutization, and using a different value
// here than the golden suite does would change relative-link output and make
// the snapshot incomparable to the committed goldens. Parse it out so the
// snapshot matches the suite exactly without maintaining a second url table.
const PAGE_URL_PATTERN = /const\s+pageUrl\s*=\s*['"]([^'"]+)['"]/;

function fixtureUrl(fixtureDir: string): string {
  try {
    const testSrc = readFileSync(join(fixtureDir, 'saved.test.ts'), 'utf8');
    const match = PAGE_URL_PATTERN.exec(testSrc);
    if (match) return match[1];
  } catch {
    // No saved.test.ts to read; fall through to the synthetic default.
  }
  return `https://example.com/${fixtureDir.slice(fixturesRoot.length + 1)}/`;
}

function payloadText(result: ReturnType<typeof extractArticleFromHtml>): string {
  const first = result.content[0];
  return first && 'text' in first ? first.text : '';
}

function discoverFixtureDirs(): string[] {
  return readdirSync(fixturesRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(fixturesRoot, entry.name))
    .filter(dir => {
      try {
        readFileSync(join(dir, 'saved.html'));
        return true;
      } catch {
        return false;
      }
    })
    .sort();
}

export function snapshotFixtures(outDir: string): SnapshotResult {
  mkdirSync(outDir, { recursive: true });

  const fixtures = discoverFixtureDirs();
  for (const fixtureDir of fixtures) {
    const name = fixtureDir.slice(fixturesRoot.length + 1);
    const html = readFileSync(join(fixtureDir, 'saved.html'), 'utf8');
    const url = fixtureUrl(fixtureDir);
    const markdown = payloadText(
      extractArticleFromHtml({ html, baseUrl: url, format: 'markdown' }),
    );
    writeFileSync(join(outDir, `${name}.md`), markdown);
  }

  const readabilityPkgPath = createRequire(import.meta.url).resolve(
    '@mozilla/readability/package.json',
  );
  const readabilityPkg = JSON.parse(
    readFileSync(readabilityPkgPath, 'utf8'),
  ) as { version?: string };

  return {
    fixtures,
    readabilityVersion: readabilityPkg.version ?? 'unknown',
  };
}

function parseOutArg(argv: readonly string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out' && i + 1 < argv.length) return argv[i + 1];
    const eq = argv[i].startsWith('--out=')
      ? argv[i].slice('--out='.length)
      : undefined;
    if (eq !== undefined) return eq;
  }
  return undefined;
}

// vite-node puts its own binary in process.argv[1], so the usual "is this the
// main module" check doesn't identify a CLI run. `--out` is only ever passed
// on the CLI (the unit test imports this module without args), so its presence
// is the reliable signal that we should execute.
const cliOut = parseOutArg(process.argv.slice(2));
if (cliOut) {
  const result = snapshotFixtures(cliOut);
  console.log(
    `snapshotted ${result.fixtures.length} fixtures @ readability ${result.readabilityVersion} → ${cliOut}`,
  );
}
