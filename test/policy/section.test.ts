import { buildDocument } from '../../src/pipeline/dom.js';
import { scopeToHeading } from '../../src/policy/section.js';
import { extractArticleFromHtml } from '../../src/tools/extract.js';

const ORIGIN = 'https://example.com/docs';

// h2 carries id="auth" so selector mode on the wrapped equivalent fixture
// (below) is a meaningful equivalence check.
const FIXTURE_HTML =
  '<main><h1>API Reference</h1><p>Intro.</p>' +
  '<h2 id="auth">Authentication</h2><p>Auth details.</p>' +
  '<h3>API Keys</h3><p>Key details.</p>' +
  '<h2>Rate Limits</h2><p>Rate info.</p></main>';

// Same content but the Authentication subtree is wrapped in <section id="auth">
// so selector:"#auth" scopes to the whole section — the boundary heading mode
// must reproduce.
const WRAPPED_FIXTURE_HTML =
  '<main><h1>API Reference</h1><p>Intro.</p>' +
  '<section id="auth"><h2>Authentication</h2><p>Auth details.</p>' +
  '<h3>API Keys</h3><p>Key details.</p></section>' +
  '<h2>Rate Limits</h2><p>Rate info.</p></main>';

// GitHub-rendered markdown: each heading sits inside a <div class="markdown-heading">
// wrapper with a permalink <a>, and the body <p> is a sibling of the wrapper div.
// Walking the <h2>'s own siblings would capture only the permalink and miss the
// body — the flow-container climb is what recovers it.
const GITHUB_DOCS_HTML =
  '<main><article>' +
  '<div class="markdown-heading"><h2>Security</h2><a href="#security">#</a></div>' +
  '<p>Use a sanitizer like DOMPurify to avoid script injection.</p>' +
  '<div class="markdown-heading"><h2>Contributing</h2><a href="#contributing">#</a></div>' +
  '<p>Please see our Contributing document.</p>' +
  '</article></main>';

const SECTION_WRAPPERS_HTML =
  '<article>' +
  '<section><h2>Security</h2><p>S body.</p></section>' +
  '<section><h2>Contributing</h2><p>C body.</p></section>' +
  '</article>';

function doc(html: string): Document {
  return buildDocument(html, ORIGIN).document;
}

function wrapText(d: Document): string | undefined {
  return d.querySelector('[data-rdrm-section-scope]')?.textContent ?? undefined;
}

describe('policy.section scopeToHeading', () => {
  it('scopes to the next same-or-higher-level heading', () => {
    const d = doc(FIXTURE_HTML);
    expect(scopeToHeading(d, 'Authentication')).toBe(true);
    const text = wrapText(d);
    expect(text).toContain('Authentication');
    expect(text).toContain('Auth details');
    expect(text).toContain('API Keys');
    expect(text).toContain('Key details');
    expect(text).not.toContain('Rate Limits');
    expect(text).not.toContain('Rate info');
    expect(text).not.toContain('API Reference');
    expect(text).not.toContain('Intro.');
  });

  it('matches heading text case-insensitively', () => {
    const d = doc(FIXTURE_HTML);
    expect(scopeToHeading(d, 'authentication')).toBe(true);
    const text = wrapText(d);
    expect(text).toContain('Authentication');
    expect(text).toContain('Auth details');
  });

  it('falls back to substring matching on the h3 and terminates at the next h3-or-higher', () => {
    const d = doc(FIXTURE_HTML);
    // "keys" is a substring of "API Keys" but not an exact match; first
    // substring (h3) wins. Section level=3, so the following h2 Rate Limits
    // (level 2 <= 3) terminates the section.
    expect(scopeToHeading(d, 'keys')).toBe(true);
    const text = wrapText(d);
    expect(text).toContain('API Keys');
    expect(text).toContain('Key details');
    expect(text).not.toContain('Authentication');
    expect(text).not.toContain('Auth details');
    expect(text).not.toContain('Rate Limits');
    expect(text).not.toContain('Rate info');
  });

  it('returns false and leaves the document unchanged when nothing matches', () => {
    const d = doc(FIXTURE_HTML);
    const before = d.body.innerHTML;
    expect(scopeToHeading(d, 'Nonexistent Section')).toBe(false);
    expect(d.body.innerHTML).toBe(before);
    expect(d.querySelector('[data-rdrm-section-scope]')).toBeNull();
  });

  it('captures the section body when headings are wrapped in markdown-heading divs (GitHub)', () => {
    const d = doc(GITHUB_DOCS_HTML);
    expect(scopeToHeading(d, 'Security')).toBe(true);
    const text = wrapText(d);
    expect(text).toContain('Security');
    expect(text).toContain('Use a sanitizer like DOMPurify');
    expect(text).not.toContain('Contributing');
    expect(text).not.toContain('Please see our Contributing document');
  });

  it('scopes to the inner section element when explicit <section> wrappers are used', () => {
    const d = doc(SECTION_WRAPPERS_HTML);
    expect(scopeToHeading(d, 'Security')).toBe(true);
    const text = wrapText(d);
    expect(text).toContain('S body.');
    expect(text).not.toContain('C body.');
    expect(text).not.toContain('Contributing');
  });

  it('produces the same boundary as selector:"#auth" on the wrapping fixture (acceptance)', () => {
    // Heading mode on the wrapped fixture must scope exactly the inner subtree
    // of <section id="auth"> — i.e. selector:"#auth" on the same HTML.
    const headingDoc = doc(WRAPPED_FIXTURE_HTML);
    expect(scopeToHeading(headingDoc, 'Authentication')).toBe(true);
    const scoped = `<!DOCTYPE html><html><head></head><body>${headingDoc.body.innerHTML}</body></html>`;
    const headingResult = extractArticleFromHtml({
      html: scoped,
      baseUrl: ORIGIN,
      selectors: { include: '[data-rdrm-section-scope]' },
    });
    const selectorResult = extractArticleFromHtml({
      html: WRAPPED_FIXTURE_HTML,
      baseUrl: ORIGIN,
      selectors: { include: '#auth' },
    });
    const headingMarkdown = String(
      (headingResult.structuredContent as { content: string }).content,
    );
    const selectorMarkdown = String(
      (selectorResult.structuredContent as { content: string }).content,
    );
    for (const needle of ['Auth details', 'API Keys', 'Key details']) {
      expect(headingMarkdown).toContain(needle);
      expect(selectorMarkdown).toContain(needle);
    }
    for (const forbidden of ['Rate info', 'API Reference', 'Intro.']) {
      expect(headingMarkdown).not.toContain(forbidden);
      expect(selectorMarkdown).not.toContain(forbidden);
    }
  });
});
