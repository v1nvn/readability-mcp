import {
  extractLinks,
  extractLinksHandler,
} from '../../src/tools/extract_links.js';
import { extractLinksOutput } from '../../src/tools/output-schema.js';

const ORIGIN = 'https://x.example/';

describe('extract_links tool', () => {
  it('absolutizes a relative href against url and marks it same-origin', () => {
    const result = extractLinks({
      html: '<nav><a href="/posts/1">Post</a></nav>',
      url: ORIGIN,
    });
    expect(result.isError).toBeFalsy();
    const parsed = extractLinksOutput.parse(result.structuredContent);
    expect(parsed.links).toEqual([
      {
        text: 'Post',
        href: 'https://x.example/posts/1',
        rel: '',
        isExternal: false,
      },
    ]);
    expect(parsed.metadata.url).toBe(ORIGIN);
  });

  it('marks a cross-origin href as external', () => {
    const result = extractLinks({
      html: '<a href="https://other.example/y">Elsewhere</a>',
      url: ORIGIN,
    });
    const parsed = extractLinksOutput.parse(result.structuredContent);
    expect(parsed.links[0]).toEqual({
      text: 'Elsewhere',
      href: 'https://other.example/y',
      rel: '',
      isExternal: true,
    });
  });

  it('captures the rel attribute verbatim', () => {
    const result = extractLinks({
      html: '<a href="/x" rel="noopener nofollow">X</a>',
      url: ORIGIN,
    });
    const parsed = extractLinksOutput.parse(result.structuredContent);
    expect(parsed.links[0]?.rel).toBe('noopener nofollow');
  });

  it('sameOriginOnly drops cross-origin links and keeps relative/fragment ones', () => {
    const result = extractLinks({
      html:
        '<a href="/posts/1">Post</a>' +
        '<a href="https://other.example/y">Elsewhere</a>' +
        '<a href="#sec">Jump</a>',
      url: ORIGIN,
      sameOriginOnly: true,
    });
    const parsed = extractLinksOutput.parse(result.structuredContent);
    expect(parsed.links.map(link => link.href)).toEqual([
      'https://x.example/posts/1',
      'https://x.example/#sec',
    ]);
    expect(parsed.links.every(link => !link.isExternal)).toBe(true);
  });

  it('absolutizes a fragment-only href and marks it same-origin', () => {
    const result = extractLinks({
      html: '<a href="#sec">Jump</a>',
      url: ORIGIN,
    });
    const parsed = extractLinksOutput.parse(result.structuredContent);
    expect(parsed.links[0]).toEqual({
      text: 'Jump',
      href: 'https://x.example/#sec',
      rel: '',
      isExternal: false,
    });
  });

  it('treats mailto/tel/javascript hrefs as non-external and leaves them verbatim', () => {
    const result = extractLinks({
      html:
        '<a href="mailto:a@b.example">mail</a>' +
        '<a href="tel:+15551234">call</a>' +
        '<a href="javascript:void(0)">js</a>',
      url: ORIGIN,
    });
    const parsed = extractLinksOutput.parse(result.structuredContent);
    expect(parsed.links.map(link => [link.href, link.isExternal])).toEqual([
      ['mailto:a@b.example', false],
      ['tel:+15551234', false],
      ['javascript:void(0)', false],
    ]);
  });

  it('preserves document order, keeps duplicates, and skips anchors with no/empty href', () => {
    const result = extractLinks({
      html:
        '<a href="/a">A</a>' +
        '<a name="bookmark">no href</a>' +
        '<a href="/a">A again</a>' +
        '<a href="">empty</a>',
      url: ORIGIN,
    });
    const parsed = extractLinksOutput.parse(result.structuredContent);
    expect(parsed.links.map(link => link.text)).toEqual(['A', 'A again']);
  });

  it('returns { isError: true } for missing html and does not throw', () => {
    const result = extractLinksHandler({});
    expect(result.isError).toBe(true);
    expect(result.content.length).toBeGreaterThan(0);
  });

  it('emits a non-empty readable payload even when no links are found', () => {
    const result = extractLinks({ html: '<p>no anchors here</p>', url: ORIGIN });
    expect(result.isError).toBeFalsy();
    expect(
      (result.structuredContent as { content: string }).content.length,
    ).toBeGreaterThan(0);
  });

  it('keeps nav/footer/main links (no normalizeDocument strip)', () => {
    const html =
      '<nav><a href="/nav-link">Nav</a></nav>' +
      '<main><a href="/main-link">Main</a></main>' +
      '<footer><a href="/footer-link">Footer</a></footer>';
    const result = extractLinks({ html, url: ORIGIN });
    const parsed = extractLinksOutput.parse(result.structuredContent);
    expect(parsed.links.map(link => link.text)).toEqual([
      'Nav',
      'Main',
      'Footer',
    ]);
  });

  it('selectors.include scopes the link walk to a subtree', () => {
    const html =
      '<nav id="nav"><a href="/n">Nav</a></nav>' +
      '<div id="peers"><a href="/p1">P1</a><a href="/p2">P2</a></div>';
    const result = extractLinks({
      html,
      url: ORIGIN,
      selectors: { include: '#peers' },
    });
    const parsed = extractLinksOutput.parse(result.structuredContent);
    expect(parsed.links.map(link => link.text)).toEqual(['P1', 'P2']);
  });

  it('selectors composes with sameOriginOnly (DOM scope + semantic filter)', () => {
    const html =
      '<div id="peers">' +
      '<a href="/p1">P1</a>' +
      '<a href="https://other.example/x">Ext</a>' +
      '</div>' +
      '<nav><a href="/n">Nav</a></nav>';
    const result = extractLinks({
      html,
      url: ORIGIN,
      sameOriginOnly: true,
      selectors: { include: '#peers' },
    });
    const parsed = extractLinksOutput.parse(result.structuredContent);
    expect(parsed.links.map(link => link.href)).toEqual([
      'https://x.example/p1',
    ]);
  });
});
