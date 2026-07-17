import { buildDocument } from '../../src/pipeline/dom.js';
import { detectGating } from '../../src/policy/gating.js';

function doc(html: string): Document {
  return buildDocument(html, 'https://example.com/article').document;
}

const CLEAN_BODY =
  '<body><article><h1>Plain article</h1>' +
  '<p>A clean article with no paywall signals at all.</p>' +
  '<p>More prose to make this readerable.</p></article></body>';

describe('policy.gating detectGating', () => {
  it('detects a Piano .tp-modal overlay', () => {
    const html =
      `<body><article><h1>X</h1><p>body</p></article>` +
      `<div class="tp-modal" role="dialog"><div class="tp-active"><h3>Subscribe</h3></div></div></body>`;
    expect(detectGating(doc(html))).toEqual({
      likely: true,
      reason: 'paywall overlay',
    });
  });

  it('detects a [class*="paywall"] surface', () => {
    const html =
      '<body><article><h1>X</h1><p>body</p></article><div class="paywall-container">…</div></body>';
    expect(detectGating(doc(html))).toEqual({
      likely: true,
      reason: 'paywall overlay',
    });
  });

  it('detects a metered-limit message ("You have 2 free articles left")', () => {
    const html =
      `<body><article><h1>X</h1><p>body text</p></article>` +
      `<p>You have 2 free articles left this month.</p></body>`;
    expect(detectGating(doc(html))).toEqual({
      likely: true,
      reason: 'metered paywall message',
    });
  });

  it('detects a "Subscribe to continue reading" message', () => {
    const html =
      `<body><article><h1>X</h1><p>body text</p></article>` +
      `<aside><p>Subscribe to continue reading.</p></aside></body>`;
    expect(detectGating(doc(html))).toEqual({
      likely: true,
      reason: 'metered paywall message',
    });
  });

  it('does NOT flag a clean article with a "Subscribe" nav link and a newsletter signup', () => {
    const html =
      `<body><nav><a href="/subscribe">Subscribe</a></nav>` +
      `<article><h1>A real article</h1><p>enough body prose to be readerable.</p></article>` +
      `<aside class="newsletter"><h3>Subscribe</h3>` +
      `<p>Get our newsletter every Thursday.</p>` +
      `<form><input type="email"><button>Subscribe</button></form></aside></body>`;
    expect(detectGating(doc(html))).toBeUndefined();
  });

  it('returns undefined when no signals are present', () => {
    expect(detectGating(doc(`<html>${CLEAN_BODY}</html>`))).toBeUndefined();
  });
});
