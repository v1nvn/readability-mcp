import { buildDocument } from '../../src/pipeline/dom.js';
import {
  canonicalizeCodeBlocks,
  normalizeDocument,
  resolveLazyImages,
  stripChrome,
} from '../../src/pipeline/normalize.js';

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

describe('stripChrome: curated consent selectors', () => {
  it('removes [role="dialog"]', () => {
    const { document } = buildDocument(
      '<html><body><article><p>body</p></article><div role="dialog">consent</div></body></html>',
    );
    expect(stripChrome(document)).toBeGreaterThanOrEqual(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector('article')).not.toBeNull();
  });

  it('removes a curated .cookie-banner', () => {
    const { document } = buildDocument(
      '<html><body><article><p>body</p></article><div class="cookie-banner">We use cookies</div></body></html>',
    );
    expect(stripChrome(document)).toBeGreaterThanOrEqual(1);
    expect(document.querySelector('.cookie-banner')).toBeNull();
  });

  it('removes #onetrust-banner-sdk', () => {
    const { document } = buildDocument(
      '<html><body><article><p>body</p></article><div id="onetrust-banner-sdk">OneTrust</div></body></html>',
    );
    expect(stripChrome(document)).toBeGreaterThanOrEqual(1);
    expect(document.querySelector('#onetrust-banner-sdk')).toBeNull();
  });

  it('counts nested consent matches as one removal per live node', () => {
    // Outer matches [role="dialog"], inner matches .cookie-banner — removing
    // the outer detaches the inner; the inner must not be double-counted.
    const { document } = buildDocument(
      '<html><body><div role="dialog"><div class="cookie-banner">nested</div></div></body></html>',
    );
    expect(stripChrome(document)).toBe(1);
  });
});

describe('stripChrome: inline-style overlay heuristic', () => {
  it('removes a full-viewport fixed overlay (width/height 100%)', () => {
    const { document } = buildDocument(
      '<html><body><article><p>body</p></article>' +
        '<div style="position:fixed;width:100%;height:100%;z-index:9999">modal</div></body></html>',
    );
    expect(stripChrome(document)).toBeGreaterThanOrEqual(1);
    expect(document.querySelector('[style]')).toBeNull();
  });

  it('removes a full-viewport overlay using vw/vh', () => {
    const { document } = buildDocument(
      '<html><body><div style="position:fixed;width:100vw;height:100vh;z-index:5000">v</div></body></html>',
    );
    expect(stripChrome(document)).toBe(1);
    expect(document.querySelector('[style]')).toBeNull();
  });

  it('removes a full-viewport overlay using inset:0', () => {
    const { document } = buildDocument(
      '<html><body><div style="position:fixed;inset:0;z-index:5000">inset</div></body></html>',
    );
    expect(stripChrome(document)).toBe(1);
    expect(document.querySelector('[style]')).toBeNull();
  });

  it('removes a full-viewport overlay using left:0+right:0 and top:0+bottom:0', () => {
    const { document } = buildDocument(
      '<html><body><div style="position:fixed;left:0;right:0;top:0;bottom:0;z-index:2000">edges</div></body></html>',
    );
    expect(stripChrome(document)).toBe(1);
    expect(document.querySelector('[style]')).toBeNull();
  });

  it('PRESERVES a fixed top nav bar (full width, short height)', () => {
    const { document } = buildDocument(
      '<html><body><header style="position:fixed;top:0;width:100%;height:60px;z-index:1000">Brand</header>' +
        '<article><p>body</p></article></body></html>',
    );
    expect(stripChrome(document)).toBe(0);
    expect(document.querySelector('header')).not.toBeNull();
    expect(document.querySelector('header')?.textContent).toBe('Brand');
  });

  it('PRESERVES a fixed element with high z-index but only width:100% (no full height)', () => {
    const { document } = buildDocument(
      '<html><body><div style="position:fixed;top:0;width:100%;z-index:9999">not an overlay</div></body></html>',
    );
    expect(stripChrome(document)).toBe(0);
    expect(document.querySelector('[style]')).not.toBeNull();
  });

  it('PRESERVES a sticky element with low z-index even if full-viewport', () => {
    const { document } = buildDocument(
      '<html><body><div style="position:sticky;inset:0;z-index:10">low z</div></body></html>',
    );
    expect(stripChrome(document)).toBe(0);
  });

  it('PRESERVES a static-positioned full-size element', () => {
    const { document } = buildDocument(
      '<html><body><div style="position:static;width:100%;height:100%;z-index:9999">static</div></body></html>',
    );
    expect(stripChrome(document)).toBe(0);
  });

  it('PRESERVES article content and prose in every case', () => {
    const { document } = buildDocument(
      '<html><body><article><p>prose that must survive</p></article>' +
        '<div role="dialog">banner</div></body></html>',
    );
    stripChrome(document);
    expect(document.querySelector('article')).not.toBeNull();
    expect(document.body.textContent).toContain('prose that must survive');
    expect(document.body.textContent).not.toContain('banner');
  });
});

describe('normalizeDocument: cleanChrome option', () => {
  it('strips chrome and reports chromeRemoved by default', () => {
    const { document } = buildDocument(
      '<html><body><article><p>body</p></article><div role="dialog">x</div></body></html>',
    );
    const counts = normalizeDocument(document);
    expect(counts.chromeRemoved).toBeGreaterThanOrEqual(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('cleanChrome: false disables stripping and reports chromeRemoved = 0', () => {
    const { document } = buildDocument(
      '<html><body><article><p>body</p></article><div role="dialog">survives</div></body></html>',
    );
    const counts = normalizeDocument(document, { cleanChrome: false });
    expect(counts.chromeRemoved).toBe(0);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector('[role="dialog"]')?.textContent).toBe(
      'survives',
    );
  });

  it('still strips scripts and base when cleanChrome is false', () => {
    const { document } = buildDocument(
      '<html><head><base href="/x"></head><body><script>var a = 1;</script></body></html>',
    );
    const counts = normalizeDocument(document, { cleanChrome: false });
    expect(counts.chromeRemoved).toBe(0);
    expect(counts.scripts).toBe(1);
    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('base')).toBeNull();
  });
});

describe('canonicalizeCodeBlocks', () => {
  it('rewrites a GitHub highlight-source-js block and unwraps the div', () => {
    const { document } = buildDocument(
      '<html><body><div class="highlight highlight-source-js"><pre><code>const x = 1;</code></pre></div></body></html>',
    );
    expect(canonicalizeCodeBlocks(document)).toBeGreaterThanOrEqual(1);
    expect(document.querySelector('div.highlight')).toBeNull();
    expect(document.querySelector('pre > code')?.getAttribute('class')).toBe(
      'language-js',
    );
  });

  it('maps highlight-source-shell to language-shell', () => {
    const { document } = buildDocument(
      '<html><body><div class="highlight highlight-source-shell"><pre><code>npm install</code></pre></div></body></html>',
    );
    canonicalizeCodeBlocks(document);
    expect(document.querySelector('pre > code')?.getAttribute('class')).toBe(
      'language-shell',
    );
  });

  it('maps a sandpack sp-javascript pre to language-javascript', () => {
    const { document } = buildDocument(
      '<html><body><pre class="sp-javascript"><code>x</code></pre></body></html>',
    );
    canonicalizeCodeBlocks(document);
    expect(document.querySelector('pre > code')?.getAttribute('class')).toBe(
      'language-javascript',
    );
  });

  it('maps a generic lang-py code class to language-py', () => {
    const { document } = buildDocument(
      '<html><body><pre><code class="lang-py">x</code></pre></body></html>',
    );
    canonicalizeCodeBlocks(document);
    expect(document.querySelector('pre > code')?.getAttribute('class')).toBe(
      'language-py',
    );
  });

  it('parses a SyntaxHighlighter brush: token and wraps bare pre text in a code', () => {
    const { document } = buildDocument(
      '<html><body><pre class="brush: java">System.out</pre></body></html>',
    );
    canonicalizeCodeBlocks(document);
    expect(document.querySelector('pre > code')?.getAttribute('class')).toBe(
      'language-java',
    );
    expect(document.querySelector('pre > code')?.textContent).toContain(
      'System.out',
    );
  });

  it('leaves an already-canonical language-ts block untouched', () => {
    const { document } = buildDocument(
      '<html><body><pre><code class="language-ts">const x: number = 1;</code></pre></body></html>',
    );
    expect(canonicalizeCodeBlocks(document)).toBe(0);
    expect(document.querySelector('pre > code')?.getAttribute('class')).toBe(
      'language-ts',
    );
  });

  it('leaves a no-hint block untouched', () => {
    const { document } = buildDocument(
      '<html><body><pre><code>x</code></pre></body></html>',
    );
    expect(canonicalizeCodeBlocks(document)).toBe(0);
    expect(document.querySelector('pre > code')?.getAttribute('class')).toBeNull();
  });

  it('does not throw on a pre with no code and garbage classes', () => {
    const { document } = buildDocument(
      '<html><body><pre class="@@@ bogus ###">leftover text</pre></body></html>',
    );
    expect(() => canonicalizeCodeBlocks(document)).not.toThrow();
    expect(canonicalizeCodeBlocks(document)).toBe(0);
  });
});
