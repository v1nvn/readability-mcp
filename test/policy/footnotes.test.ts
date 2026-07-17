import { processFootnotes } from '../../src/policy/footnotes.js';

describe('policy.footnotes processFootnotes', () => {
  it('converts paired sup refs + ordered footnotes list into markdown refs', () => {
    const html =
      '<p>Claim one<sup><a href="#fn-1">1</a></sup> and claim two<sup><a href="#fn-2">2</a></sup>.</p>' +
      '<ol class="footnotes"><li id="fn-1">First note</li><li id="fn-2">Second note</li></ol>';

    const result = processFootnotes(html);
    expect(result).not.toBeNull();
    expect(result?.footnoteDefs).toEqual(['First note', 'Second note']);
    expect(result?.html).toContain('[^1]');
    expect(result?.html).toContain('[^2]');
    expect(result?.html).not.toContain('<ol');
    expect(result?.html).not.toContain('First note');
  });

  it('handles Wikipedia-style cite_ref/cite_note pairs and strips the leading backref caret', () => {
    // Real Wikipedia markup places the back-to-text caret BEFORE the citation
    // text; cleanDefText strips only a leading caret, matching that convention.
    const html =
      '<p>Smith argued this<sup id="cite_ref-1"><a href="#cite_note-1">[1]</a></sup> strongly.</p>' +
      '<ol class="references"><li id="cite_note-1"><a href="#cite_ref-1">^</a> <span>Smith (2020).</span></li></ol>';

    const result = processFootnotes(html);
    expect(result).not.toBeNull();
    expect(result?.footnoteDefs).toEqual(['Smith (2020).']);
    expect(result?.html).toContain('[^1]');
    expect(result?.html).not.toContain('cite_note');
    expect(result?.html).not.toContain('references');
    expect(result?.footnoteDefs[0]).not.toContain('^');
  });

  it('reuses the same number when a definition is referenced more than once', () => {
    const html =
      '<p>First mention<sup><a href="#fn-1">1</a></sup>, second mention<sup><a href="#fn-1">1</a></sup>.</p>' +
      '<ol class="footnotes"><li id="fn-1">Shared note</li></ol>';

    const result = processFootnotes(html);
    expect(result).not.toBeNull();
    expect(result?.footnoteDefs).toEqual(['Shared note']);
    const markers = result?.html.match(/\[\^1\]/g) ?? [];
    expect(markers).toHaveLength(2);
    expect(result?.html).not.toContain('[^2]');
  });

  it('leaves a <sup> untouched when it does not link to a known definition', () => {
    const html =
      '<p>Plain trademark<sup>TM</sup> and note<sup><a href="#fn-1">1</a></sup>.</p>' +
      '<ol class="footnotes"><li id="fn-1">Real note</li></ol>';

    const result = processFootnotes(html);
    expect(result).not.toBeNull();
    expect(result?.html).toContain('<sup>TM</sup>');
    expect(result?.html).toContain('[^1]');
  });

  it('returns null when no footnote markup signals are present', () => {
    expect(processFootnotes('<p>Just a paragraph with a <sup>2</sup> superscript.</p>')).toBeNull();
  });

  it('returns null when a sup links to a fragment but no definitions exist', () => {
    const html = '<p>Loose ref<sup><a href="#fn-1">1</a></sup> with no list.</p>';
    expect(processFootnotes(html)).toBeNull();
  });

  it('returns null when definitions exist but no refs link to them', () => {
    const html =
      '<p>Text with no link.</p><ol class="footnotes"><li id="fn-1">Orphan note</li></ol>';
    expect(processFootnotes(html)).toBeNull();
  });

  it('collects standalone <li id="fn-..."> scattered outside a container', () => {
    const html =
      '<p>See this<sup><a href="#fn-1">1</a></sup>.</p>' +
      '<ul><li id="fn-1">Standalone def text.</li></ul>';
    const result = processFootnotes(html);
    expect(result).not.toBeNull();
    expect(result?.footnoteDefs).toEqual(['Standalone def text.']);
    expect(result?.html).toContain('[^1]');
    expect(result?.html).not.toContain('Standalone def text');
  });

  it('never throws on malformed markup', () => {
    const html = '<sup><a href="#fn1"';
    expect(() => processFootnotes(html)).not.toThrow();
  });
});
