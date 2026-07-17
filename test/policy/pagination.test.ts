import { buildDocument } from '../../src/pipeline/dom.js';
import { detectPagination } from '../../src/policy/pagination.js';

function doc(html: string, url?: string): Document {
  return buildDocument(html, url).document;
}

const BASE_URL = 'https://example.com/guide/page-1';

describe('policy.pagination detectPagination', () => {
  it('detects <link rel="next"> and absolutizes the href', () => {
    const html =
      '<head><link rel="next" href="/guide/page-2"></head><body><article><p>body</p></article></body>';
    expect(detectPagination(doc(html, BASE_URL), BASE_URL)).toEqual({
      type: 'paginated',
      nextUrl: 'https://example.com/guide/page-2',
    });
  });

  it('detects <a rel="next">', () => {
    const html =
      '<body><article><p>body</p></article><a rel="next" href="/guide/page-2">Next</a></body>';
    expect(detectPagination(doc(html, BASE_URL), BASE_URL)).toEqual({
      type: 'paginated',
      nextUrl: 'https://example.com/guide/page-2',
    });
  });

  it('detects a short next-page text link (Next →)', () => {
    const html =
      '<body><article><p>body</p></article><a href="/guide/page-2">Next →</a></body>';
    expect(detectPagination(doc(html, BASE_URL), BASE_URL)).toEqual({
      type: 'paginated',
      nextUrl: 'https://example.com/guide/page-2',
    });
  });

  it('detects a [data-load-more] sentinel as infinite', () => {
    const html =
      '<body><article><p>body</p></article><button data-load-more>Load more</button></body>';
    expect(detectPagination(doc(html, BASE_URL), BASE_URL)).toEqual({
      type: 'infinite',
      selector: '[data-load-more]',
    });
  });

  it('detects a [class*="load-more"] sentinel as infinite', () => {
    const html =
      '<body><article><p>body</p></article><div class="load-more"><button>Load more</button></div></body>';
    expect(detectPagination(doc(html, BASE_URL), BASE_URL)).toEqual({
      type: 'infinite',
      selector: '[class*="load-more"]',
    });
  });

  it('returns undefined when no pagination signal is present', () => {
    const html =
      '<body><article><h1>Title</h1><p>A plain article with no next link and no sentinel.</p></article></body>';
    expect(detectPagination(doc(html, BASE_URL), BASE_URL)).toBeUndefined();
  });

  it('absolutizes a relative href against the passed url', () => {
    const html =
      '<head><link rel="next" href="../page-2"></head><body><article><p>body</p></article></body>';
    expect(detectPagination(doc(html, 'https://example.com/guide/'), 'https://example.com/guide/')).toEqual({
      type: 'paginated',
      nextUrl: 'https://example.com/page-2',
    });
  });

  it('prefers paginated over infinite when both signals are present', () => {
    const html =
      '<head><link rel="next" href="/guide/page-2"></head>' +
      '<body><article><p>body</p></article>' +
      '<div class="load-more"><button data-load-more>Load more</button></div></body>';
    expect(detectPagination(doc(html, BASE_URL), BASE_URL)).toEqual({
      type: 'paginated',
      nextUrl: 'https://example.com/guide/page-2',
    });
  });

  it('ignores href="#" on a next-link anchor (falls through)', () => {
    const html =
      '<body><article><p>body</p></article><a href="#">Next</a></body>';
    expect(detectPagination(doc(html, BASE_URL), BASE_URL)).toBeUndefined();
  });

  it('does not match long prose links that happen to start with "next"', () => {
    const html =
      '<body><article><p>body</p></article><a href="/elsewhere">next, we cover rendering strategies in depth</a></body>';
    expect(detectPagination(doc(html, BASE_URL), BASE_URL)).toBeUndefined();
  });
});
