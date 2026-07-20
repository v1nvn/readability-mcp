import { buildDocument } from '../../src/pipeline/dom.js';
import { extractArticleFromHtml } from '../../src/tools/extract.js';
import { collectImageInventory } from '../../src/policy/images.js';

const ORIGIN = 'https://x.example/p';

const DATA_GIF =
  'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

function collect(html: string, url: string = ORIGIN) {
  const { window } = buildDocument('<!DOCTYPE html><html><body></body></html>');
  return collectImageInventory(html, window, url);
}

describe('policy.images collectImageInventory', () => {
  it('absolutizes relative srcs against url', () => {
    const entries = collect('<figure><img src="/img/a.jpg" alt="A"></figure>');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.src).toBe('https://x.example/img/a.jpg');
    expect(entries[0]?.alt).toBe('A');
  });

  it('keeps an already-absolute src unchanged', () => {
    const entries = collect(
      '<img src="https://cdn.example.com/b.jpg" alt="B">',
    );
    expect(entries[0]?.src).toBe('https://cdn.example.com/b.jpg');
  });

  it('skips data: URI placeholders but keeps the real src beside them', () => {
    const entries = collect(
      `<img src="${DATA_GIF}" alt="placeholder">` +
        '<img src="/img/real.jpg" alt="Real">',
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.src).toBe('https://x.example/img/real.jpg');
    expect(entries[0]?.alt).toBe('Real');
  });

  it('skips placeholder-token srcs (spacer/lazy/dummy)', () => {
    const entries = collect(
      '<img src="/static/spacer.gif" alt="spacer">' +
        '<img src="/img/lazy-placeholder.gif" alt="lazy">' +
        '<img src="/img/dummy.png" alt="dummy">' +
        '<img src="/img/keep.jpg" alt="keep">',
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.alt).toBe('keep');
  });

  it('uses figcaption as caption when the img is inside a <figure>', () => {
    const entries = collect(
      '<figure><img src="/a.jpg" alt="A"><figcaption>The real caption</figcaption></figure>',
    );
    expect(entries[0]?.caption).toBe('The real caption');
  });

  it('uses figcaption when it PRECEDES the img inside the <figure>', () => {
    const entries = collect(
      '<figure><figcaption>Leading caption</figcaption><img src="/a.jpg" alt="A"></figure>',
    );
    expect(entries[0]?.caption).toBe('Leading caption');
  });

  it('falls back to alt when no <figure>/figcaption encloses the img', () => {
    const entries = collect('<img src="/b.jpg" alt="B">');
    expect(entries[0]?.caption).toBe('B');
  });

  it('collapses whitespace inside figcaption text', () => {
    const entries = collect(
      '<figure><img src="/a.jpg" alt="A"><figcaption>Line one\n  line two</figcaption></figure>',
    );
    expect(entries[0]?.caption).toBe('Line one line two');
  });

  it('includes width/height when positive integer attributes are present', () => {
    const entries = collect(
      '<img src="/c.jpg" alt="C" width="800" height="600">',
    );
    expect(entries[0]?.width).toBe(800);
    expect(entries[0]?.height).toBe(600);
  });

  it('omits width/height when absent (undefined, not 0)', () => {
    const entries = collect('<img src="/d.jpg" alt="D">');
    expect(entries[0]?.width).toBeUndefined();
    expect(entries[0]?.height).toBeUndefined();
    expect(entries[0]).not.toHaveProperty('width');
    expect(entries[0]).not.toHaveProperty('height');
  });

  it('omits non-positive / non-integer width/height', () => {
    const entries = collect(
      '<img src="/e.jpg" alt="E" width="0" height="-10">' +
        '<img src="/f.jpg" alt="F" width="not-a-number">',
    );
    expect(entries[0]).not.toHaveProperty('width');
    expect(entries[0]).not.toHaveProperty('height');
    expect(entries[1]).not.toHaveProperty('width');
  });

  it('preserves document order across multiple images', () => {
    const entries = collect(
      '<img src="/1.jpg" alt="one">' +
        '<img src="/2.jpg" alt="two">' +
        '<img src="/3.jpg" alt="three">',
    );
    expect(entries.map(e => e.alt)).toEqual(['one', 'two', 'three']);
  });

  it('returns an empty array for empty html', () => {
    expect(collect('')).toEqual([]);
  });

  it('returns src unchanged when url is omitted', () => {
    const { window } = buildDocument(
      '<!DOCTYPE html><html><body></body></html>',
    );
    const entries = collectImageInventory(
      '<img src="/img/a.jpg" alt="A">',
      window,
    );
    expect(entries[0]?.src).toBe('/img/a.jpg');
  });

  it('end-to-end: extract emits structuredContent.images when imageInventory:true', () => {
    const html =
      '<html><head><title>T</title></head><body><article>' +
      '<h1>Article</h1>' +
      '<p>Body text long enough to be readerable.</p>' +
      '<figure><img src="/img/a.jpg" alt="A"><figcaption>Cap A</figcaption></figure>' +
      `<img src="${DATA_GIF}" alt="placeholder">` +
      '<img src="/img/b.jpg" alt="B" width="100" height="50">' +
      '</article></body></html>';
    const result = extractArticleFromHtml({
      html,
      baseUrl: 'https://x.example/article',
      imageInventory: true,
    });
    const images = (result.structuredContent as { images?: unknown }).images as Array<{
      src: string;
      alt: string;
      caption: string;
      width?: number;
      height?: number;
    }>;
    expect(images).toHaveLength(2);
    expect(images[0]).toMatchObject({
      src: 'https://x.example/img/a.jpg',
      alt: 'A',
      caption: 'Cap A',
    });
    expect(images[1]).toMatchObject({
      src: 'https://x.example/img/b.jpg',
      alt: 'B',
      caption: 'B',
      width: 100,
      height: 50,
    });
  });

  it('end-to-end: structuredContent.images is absent by default', () => {
    const html =
      '<html><head><title>T</title></head><body><article>' +
      '<h1>Article</h1><p>Body text long enough to be readerable.</p>' +
      '<img src="/img/a.jpg" alt="A">' +
      '</article></body></html>';
    const result = extractArticleFromHtml({
      html,
      baseUrl: 'https://x.example/article',
    });
    expect(result.structuredContent).not.toHaveProperty('images');
  });
});
