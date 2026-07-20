import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { readHtmlFile } from '../../src/tools/html-source.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, '../fixtures/documentation/saved.html');

describe('readHtmlFile', () => {
  it('reads the file as utf8 text', () => {
    expect(readHtmlFile(fixturePath)).toContain('<html');
  });

  it('throws on a missing file so the handler try/catch surfaces isError', () => {
    expect(() => readHtmlFile('/nonexistent/path.html')).toThrow();
  });
});
