// Focused unit tests for `resolveLazyImages` (QUAL-1). The cross-seam suite
// covers `normalizeDocument` itself; this file exercises each precedence branch
// and the placeholder-detection heuristic in isolation.

import { buildDocument } from '../../src/pipeline/dom.js';
import { resolveLazyImages } from '../../src/pipeline/normalize.js';

const DATA_GIF =
  'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

function imgSrc(document: Document): string | null {
  return document.querySelector('img')?.getAttribute('src') ?? null;
}

describe('resolveLazyImages: placeholder detection', () => {
  it('swaps a data: URI placeholder', () => {
    const { document } = buildDocument(
      `<html><body><img src="${DATA_GIF}" data-src="https://ex.com/a.jpg"></body></html>`,
    );
    expect(resolveLazyImages(document)).toBe(1);
    expect(imgSrc(document)).toBe('https://ex.com/a.jpg');
  });

  it('swaps an empty src', () => {
    const { document } = buildDocument(
      '<html><body><img src="" data-src="https://ex.com/a.jpg"></body></html>',
    );
    expect(resolveLazyImages(document)).toBe(1);
    expect(imgSrc(document)).toBe('https://ex.com/a.jpg');
  });

  it('swaps a missing src', () => {
    const { document } = buildDocument(
      '<html><body><img data-src="https://ex.com/a.jpg"></body></html>',
    );
    expect(resolveLazyImages(document)).toBe(1);
    expect(imgSrc(document)).toBe('https://ex.com/a.jpg');
  });

  it('swaps common placeholder path tokens (spacer/blank/1x1)', () => {
    const cases = [
      '/static/spacer.gif',
      '/img/blank.png',
      '/assets/1x1.png',
      '/lazy-placeholder.gif',
      '/images/dummy.gif',
      '/pixel.png',
      '/static/transparent.gif',
      '/loading-spinner.gif',
    ];
    for (const src of cases) {
      const { document } = buildDocument(
        `<html><body><img src="${src}" data-src="https://ex.com/real.jpg"></body></html>`,
      );
      expect(resolveLazyImages(document), `for src="${src}"`).toBe(1);
      expect(imgSrc(document)).toBe('https://ex.com/real.jpg');
    }
  });

  it('leaves a real-looking src untouched even when data-src is present', () => {
    const { document } = buildDocument(
      '<html><body><img src="https://ex.com/static/architecture.png" data-src="https://ex.com/other.jpg"></body></html>',
    );
    expect(resolveLazyImages(document)).toBe(0);
    expect(imgSrc(document)).toBe('https://ex.com/static/architecture.png');
  });
});

describe('resolveLazyImages: source precedence', () => {
  it('prefers data-src over srcset and data-* fallbacks', () => {
    const { document } = buildDocument(
      `<html><body><img src="${DATA_GIF}" data-src="https://ex.com/data-src.jpg" srcset="https://ex.com/srcset.jpg 1x" data-original="https://ex.com/original.jpg"></body></html>`,
    );
    expect(resolveLazyImages(document)).toBe(1);
    expect(imgSrc(document)).toBe('https://ex.com/data-src.jpg');
  });

  it('uses the largest candidate from a <picture> <source srcset>', () => {
    const { document } = buildDocument(`
      <html><body>
        <picture>
          <source srcset="https://ex.com/chart-320.png 320w, https://ex.com/chart-1600.png 1600w">
          <img src="${DATA_GIF}" alt="chart">
        </picture>
      </body></html>
    `);
    expect(resolveLazyImages(document)).toBe(1);
    expect(imgSrc(document)).toBe('https://ex.com/chart-1600.png');
  });

  it('skips <source> with a media constraint and uses the next unconstrained source', () => {
    const { document } = buildDocument(`
      <html><body>
        <picture>
          <source media="(min-width: 800px)" srcset="https://ex.com/wide.png 1600w">
          <source srcset="https://ex.com/narrow.png 800w">
          <img src="${DATA_GIF}" alt="chart">
        </picture>
      </body></html>
    `);
    expect(resolveLazyImages(document)).toBe(1);
    expect(imgSrc(document)).toBe('https://ex.com/narrow.png');
  });

  it('uses the largest candidate from the img own srcset', () => {
    const { document } = buildDocument(
      `<html><body><img src="${DATA_GIF}" srcset="https://ex.com/small.jpg 320w, https://ex.com/large.jpg 1600w"></body></html>`,
    );
    expect(resolveLazyImages(document)).toBe(1);
    expect(imgSrc(document)).toBe('https://ex.com/large.jpg');
  });

  it('takes the first srcset candidate when descriptors are absent', () => {
    const { document } = buildDocument(
      `<html><body><img src="${DATA_GIF}" srcset="https://ex.com/first.jpg, https://ex.com/second.jpg"></body></html>`,
    );
    expect(resolveLazyImages(document)).toBe(1);
    expect(imgSrc(document)).toBe('https://ex.com/first.jpg');
  });

  it('falls back to data-original then data-lazy-src', () => {
    const a = buildDocument(
      `<html><body><img src="${DATA_GIF}" data-original="https://ex.com/original.jpg" data-lazy-src="https://ex.com/lazy.jpg"></body></html>`,
    );
    expect(resolveLazyImages(a.document)).toBe(1);
    expect(imgSrc(a.document)).toBe('https://ex.com/original.jpg');

    const b = buildDocument(
      `<html><body><img src="${DATA_GIF}" data-lazy-src="https://ex.com/lazy.jpg"></body></html>`,
    );
    expect(resolveLazyImages(b.document)).toBe(1);
    expect(imgSrc(b.document)).toBe('https://ex.com/lazy.jpg');
  });

  it('leaves src as-is when no real source can be resolved', () => {
    const { document } = buildDocument(
      `<html><body><img src="${DATA_GIF}"></body></html>`,
    );
    expect(resolveLazyImages(document)).toBe(0);
    expect(imgSrc(document)).toBe(DATA_GIF);
  });
});

describe('resolveLazyImages: robustness', () => {
  it('is idempotent (second run rewrites nothing)', () => {
    const { document } = buildDocument(
      `<html><body><img src="${DATA_GIF}" data-src="https://ex.com/a.jpg"></body></html>`,
    );
    expect(resolveLazyImages(document)).toBe(1);
    const afterFirst = imgSrc(document);
    expect(resolveLazyImages(document)).toBe(0);
    expect(imgSrc(document)).toBe(afterFirst);
  });

  it('does not throw on malformed srcset and skips the bad entry', () => {
    const { document } = buildDocument(
      `<html><body><img src="${DATA_GIF}" srcset=",,, https://ex.com/good.jpg 1x, not a url"></body></html>`,
    );
    expect(resolveLazyImages(document)).toBe(1);
    expect(imgSrc(document)).toBe('https://ex.com/good.jpg');
  });

  it('does not throw on malformed markup', () => {
    const { document } = buildDocument('<html><body><img><div><picture');
    expect(() => resolveLazyImages(document)).not.toThrow();
  });
});
