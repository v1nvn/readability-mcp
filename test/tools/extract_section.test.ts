import { extractSection, extractSectionHandler } from '../../src/tools/extract_section.js';
import { outputSchema } from '../../src/tools/output-schema.js';

const ORIGIN = 'https://example.com/docs';

const FIXTURE_HTML =
  '<main><h1>API Reference</h1><p>Intro.</p>' +
  '<h2 id="auth">Authentication</h2><p>Auth details.</p>' +
  '<h3>API Keys</h3><p>Key details.</p>' +
  '<h2>Rate Limits</h2><p>Rate info.</p></main>';

describe('extract_section tool', () => {
  it('heading mode scopes to the matched section and skips siblings', () => {
    const result = extractSection({
      html: FIXTURE_HTML,
      url: ORIGIN,
      heading: 'Authentication',
    });
    expect(result.isError).toBeFalsy();
    const parsed = outputSchema.parse(result.structuredContent);
    expect(parsed.content).toContain('Auth details');
    expect(parsed.content).toContain('Key details');
    expect(parsed.content).not.toContain('Rate info');
    expect(parsed.content).not.toContain('API Reference');
  });

  it('heading mode captures the section body when headings are wrapped (GitHub markdown)', () => {
    const html =
      '<main><article>' +
      '<div class="markdown-heading"><h2>Security</h2><a href="#security">#</a></div>' +
      '<p>Use a sanitizer like DOMPurify to avoid script injection.</p>' +
      '<div class="markdown-heading"><h2>Contributing</h2><a href="#contributing">#</a></div>' +
      '<p>Please see our Contributing document.</p>' +
      '</article></main>';
    const result = extractSection({ html, url: ORIGIN, heading: 'Security' });
    expect(result.isError).toBeFalsy();
    const parsed = outputSchema.parse(result.structuredContent);
    expect(parsed.content).toContain('Use a sanitizer like DOMPurify');
    expect(parsed.content).not.toContain('Please see our Contributing document');
  });

  it('selector mode passes straight through to selectors.include', () => {
    const result = extractSection({
      html: FIXTURE_HTML,
      url: ORIGIN,
      selector: '#auth',
    });
    expect(result.isError).toBeFalsy();
    const parsed = outputSchema.parse(result.structuredContent);
    // #auth matches the h2 itself; selectors.include replaces body with that
    // single element, so only the heading text survives.
    expect(parsed.content).toContain('Authentication');
    expect(parsed.content).not.toContain('Auth details');
    expect(parsed.content).not.toContain('Rate info');
  });

  it('returns { isError: true } when no heading matches', () => {
    const result = extractSectionHandler({
      html: FIXTURE_HTML,
      heading: 'Nonexistent',
    });
    expect(result.isError).toBe(true);
  });

  it('returns { isError: true } when both selector and heading are set', () => {
    const result = extractSectionHandler({
      html: FIXTURE_HTML,
      selector: '#auth',
      heading: 'Authentication',
    });
    expect(result.isError).toBe(true);
  });

  it('returns { isError: true } when neither selector nor heading is set', () => {
    const result = extractSectionHandler({ html: FIXTURE_HTML });
    expect(result.isError).toBe(true);
  });
});
