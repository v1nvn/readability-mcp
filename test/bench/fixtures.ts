import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

export interface BenchFixture {
  readonly category: string;
  readonly id: string;
  readonly path: string;
  readonly url: string;
}

// Each url mirrors the one its fixture's saved.test.ts uses, so the bench
// exercises the same origin context the golden suite does.
export const BENCH_FIXTURES: readonly BenchFixture[] = [
  {
    category: 'article',
    id: 'react-spa',
    path: 'test/fixtures/react-spa/saved.html',
    url: 'https://example.com/blog/post',
  },
  {
    category: 'documentation',
    id: 'documentation',
    path: 'test/fixtures/documentation/saved.html',
    url: 'https://docs.example.com/typescript/arrays',
  },
  {
    category: 'documentation',
    id: 'outline',
    path: 'test/fixtures/outline/saved.html',
    url: 'https://docs.example.com/api',
  },
  {
    category: 'article',
    id: 'fallback',
    path: 'test/fixtures/fallback/saved.html',
    url: 'https://aurora.example.com/',
  },
  {
    category: 'article',
    id: 'lazy-images',
    path: 'test/fixtures/lazy-images/saved.html',
    url: 'https://example.com/blog/lazy',
  },
  {
    category: 'article',
    id: 'consent-banner',
    path: 'test/fixtures/consent-banner/saved.html',
    url: 'https://news.example.com/world/consent-overlays',
  },
  {
    category: 'github',
    id: 'code-langs',
    path: 'test/fixtures/code-langs/saved.html',
    url: 'https://docs.example.com/guides/code-langs',
  },
];

export function resolveFixturePath(fixture: BenchFixture): string {
  return join(repoRoot, fixture.path);
}
