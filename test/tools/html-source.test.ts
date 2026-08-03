import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { readHtmlFile } from '../../src/tools/html-source.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, '../fixtures/documentation/saved.html');

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length !== 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function writeTemp(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'html-source-'));
  tempDirs.push(dir);
  const file = join(dir, 'input.html');
  writeFileSync(file, content, 'utf8');
  return file;
}

describe('readHtmlFile', () => {
  it('reads the file as utf8 text', () => {
    expect(readHtmlFile(fixturePath)).toContain('<html');
  });

  it('throws on a missing file so the handler try/catch surfaces isError', () => {
    expect(() => readHtmlFile('/nonexistent/path.html')).toThrow();
  });

  it('returns raw HTML unchanged when it does not start with a quote', () => {
    const file = writeTemp('<html><body>hi</body></html>');
    expect(readHtmlFile(file)).toBe('<html><body>hi</body></html>');
  });

  it('unwraps a JSON string scalar to the underlying HTML', () => {
    const file = writeTemp('"<html><body>hi</body></html>"');
    expect(readHtmlFile(file)).toBe('<html><body>hi</body></html>');
  });

  it('resolves escape sequences when unwrapping a JSON string scalar', () => {
    const file = writeTemp('"<!DOCTYPE html><html lang=\\"en\\"><body>x</body></html>"');
    expect(readHtmlFile(file)).toBe('<!DOCTYPE html><html lang="en"><body>x</body></html>');
  });

  it('does not unwrap a JSON object (the key holding HTML is ambiguous)', () => {
    const file = writeTemp('{ "probe": 1, "html": "<x/>" }');
    expect(readHtmlFile(file)).toBe('{ "probe": 1, "html": "<x/>" }');
  });

  it('does not unwrap JSON number, array, or boolean scalars', () => {
    const num = writeTemp('42');
    expect(readHtmlFile(num)).toBe('42');

    const arr = writeTemp('["a","b"]');
    expect(readHtmlFile(arr)).toBe('["a","b"]');

    const bool = writeTemp('true');
    expect(readHtmlFile(bool)).toBe('true');
  });

  it('returns bare non-JSON content unchanged', () => {
    const file = writeTemp('hello world');
    expect(readHtmlFile(file)).toBe('hello world');
  });
});
