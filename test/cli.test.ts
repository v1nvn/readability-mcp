import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseArgs, readHtml, runCli } from '../src/cli.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, 'fixtures/documentation/saved.html');
const goldenPath = join(here, 'fixtures/documentation/saved.golden.md');

describe('cli parseArgs', () => {
  it('defaults format to md with no file', () => {
    expect(parseArgs(['extract'])).toEqual({
      file: undefined,
      format: 'md',
      maxChars: undefined,
      stdin: false,
    });
  });

  it('parses file, format, and max-chars together', () => {
    expect(
      parseArgs(['extract', 'a.html', '--format', 'json', '--max-chars', '100']),
    ).toEqual({
      file: 'a.html',
      format: 'json',
      maxChars: 100,
      stdin: false,
    });
  });

  it('parses the --stdin alias as a no-op boolean', () => {
    expect(parseArgs(['extract', '--stdin'])).toEqual({
      file: undefined,
      format: 'md',
      maxChars: undefined,
      stdin: true,
    });
  });

  it('rejects an unknown format value', () => {
    expect(parseArgs(['extract', '--format', 'xml'])).toBeUndefined();
  });

  it('rejects an unknown flag', () => {
    expect(parseArgs(['extract', '--bogus'])).toBeUndefined();
  });

  it('rejects a non-integer max-chars', () => {
    expect(parseArgs(['extract', '--max-chars', '1.5'])).toBeUndefined();
  });
});

describe('cli readHtml', () => {
  it('reads the file when a path is given (stream ignored)', async () => {
    const html = await readHtml(fixturePath, Readable.from([]));
    expect(html).toContain('<html');
  });

  it('reads the injected stream when no file is given', async () => {
    const html = await readHtml(undefined, Readable.from('<p>hi</p>'));
    expect(html).toBe('<p>hi</p>');
  });
});

describe('cli runCli', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  function stdout(): string {
    return stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join('');
  }

  function stderr(): string {
    return stderrSpy.mock.calls.map((c: unknown[]) => c[0]).join('');
  }

  it('extracts markdown from a file and matches the golden substring', async () => {
    const code = await runCli(['extract', fixturePath, '--format', 'md']);
    expect(code).toBe(0);

    const out = stdout();
    const golden = readFileSync(goldenPath, 'utf8');
    expect(out).toContain('# Working with Arrays in TypeScript');
    expect(out).toContain('```ts');
    expect(out).toContain(golden);
    expect(stderr()).toBe('');
  });

  it('emits structured JSON with --format json', async () => {
    const code = await runCli(['extract', fixturePath, '--format', 'json']);
    expect(code).toBe(0);

    const parsed = JSON.parse(stdout()) as {
      schemaVersion: number;
      content: string;
      metadata: { title?: string };
    };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.content).toContain('# Working with Arrays in TypeScript');
    expect(parsed.metadata.title).toBeDefined();
  });

  it('emits HTML with --format html', async () => {
    const code = await runCli(['extract', fixturePath, '--format', 'html']);
    expect(code).toBe(0);
    expect(stdout()).toMatch(/<\w+/);
  });

  it('exits 1 on a missing file with a stderr message', async () => {
    const code = await runCli(['extract', '/nonexistent/path.html']);
    expect(code).toBe(1);
    expect(stderr()).not.toBe('');
    expect(stdout()).toBe('');
  });

  it('returns 2 for a non-extract invocation', async () => {
    const code = await runCli(['--help']);
    expect(code).toBe(2);
    expect(stderr()).toContain('Usage:');
  });
});
