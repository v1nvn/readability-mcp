// resolveOutline unit tests. Pure DOM walk over a normalized document;
// mirrors metadata.test.ts with a `doc(html)` helper.

import { buildDocument } from '../../src/pipeline/dom.js';
import { resolveOutline } from '../../src/policy/outline.js';

function doc(html: string): Document {
  return buildDocument(html, 'https://example.com/page').document;
}

describe('policy.outline resolveOutline', () => {
  it('returns headings in document order with correct level numbers', () => {
    const html =
      '<h1>Title</h1><h2>Section</h2><h3>Sub</h3><h4>Deep</h4><h5>Deeper</h5><h6>Deepest</h6>';
    expect(resolveOutline(doc(html))).toEqual([
      { level: 1, text: 'Title', anchor: 'title' },
      { level: 2, text: 'Section', anchor: 'section' },
      { level: 3, text: 'Sub', anchor: 'sub' },
      { level: 4, text: 'Deep', anchor: 'deep' },
      { level: 5, text: 'Deeper', anchor: 'deeper' },
      { level: 6, text: 'Deepest', anchor: 'deepest' },
    ]);
  });

  it('uses the heading id attribute as the anchor', () => {
    const html = '<h2 id="auth">Authentication</h2>';
    expect(resolveOutline(doc(html))).toEqual([
      { level: 2, text: 'Authentication', anchor: 'auth' },
    ]);
  });

  it('uses the href fragment of a descendant anchor link as the anchor', () => {
    const html = '<h2>Overview<a class="anchor" href="#overview"></a></h2>';
    expect(resolveOutline(doc(html))).toEqual([
      { level: 2, text: 'Overview', anchor: 'overview' },
    ]);
  });

  it('falls back to a slug of the text when no id or anchor link is present', () => {
    // "!" is deleted by the slug charset, internal whitespace -> single dash.
    const html = '<h2>Getting Started!</h2>';
    expect(resolveOutline(doc(html))).toEqual([
      { level: 2, text: 'Getting Started!', anchor: 'getting-started' },
    ]);
  });

  it('gives duplicate-text headings distinct anchors (bare, -1, -2)', () => {
    const html = '<h2>Intro</h2><h2>Intro</h2><h2>Intro</h2>';
    expect(resolveOutline(doc(html))).toEqual([
      { level: 2, text: 'Intro', anchor: 'intro' },
      { level: 2, text: 'Intro', anchor: 'intro-1' },
      { level: 2, text: 'Intro', anchor: 'intro-2' },
    ]);
  });

  it('skips headings whose trimmed text is empty', () => {
    const html = '<h1>Real</h1><h2>   </h2><h2></h2><h3>Also Real</h3>';
    expect(resolveOutline(doc(html))).toEqual([
      { level: 1, text: 'Real', anchor: 'real' },
      { level: 3, text: 'Also Real', anchor: 'also-real' },
    ]);
  });

  it('strips a trailing permalink # from the heading text', () => {
    // No anchor link here, so the slug is derived from the cleaned text.
    const html = '<h3>Title#</h3>';
    expect(resolveOutline(doc(html))).toEqual([
      { level: 3, text: 'Title', anchor: 'title' },
    ]);
  });

  it('handles a GitHub permalink heading: strips # text and uses the link href', () => {
    const html = '<h2>Title<a class="anchor" href="#title">#</a></h2>';
    expect(resolveOutline(doc(html))).toEqual([
      { level: 2, text: 'Title', anchor: 'title' },
    ]);
  });

  it('uses an explicit id verbatim and does NOT suffix it on collision', () => {
    // First and third headings carry the same explicit id; the middle heading
    // slug-collides with it. Author ids stay verbatim; only generated slugs
    // get the -N suffix.
    const html =
      '<h2 id="section">First</h2><h2>Section</h2><h2 id="section">Third</h2>';
    expect(resolveOutline(doc(html))).toEqual([
      { level: 2, text: 'First', anchor: 'section' },
      { level: 2, text: 'Section', anchor: 'section-1' },
      { level: 2, text: 'Third', anchor: 'section' },
    ]);
  });
});
