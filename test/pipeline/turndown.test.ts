import { toMarkdown } from '../../src/pipeline/turndown.js';

const pageUrl = 'https://example.com/page';

describe('turndown image modes', () => {
  const html = '<p>before</p><img src="/a.png" alt="diagram"><p>after</p>';

  it('keep: renders inline image markdown', () => {
    const md = toMarkdown(html, { images: 'keep', url: pageUrl });
    expect(md).toContain('![diagram](https://example.com/a.png)');
  });

  it('drop: emits no image syntax', () => {
    const md = toMarkdown(html, { images: 'drop' });
    expect(md).not.toContain('![');
    expect(md).not.toContain('a.png');
  });

  it('src-only: emits the bare URL (alt dropped) on its own line', () => {
    const md = toMarkdown(html, { images: 'src-only', url: pageUrl });
    expect(md).not.toContain('![diagram]');
    expect(md).toContain('https://example.com/a.png');
  });

  it('reference: emits ![alt][img-N] with a link-ref block appended', () => {
    const two = '<img src="/x.png" alt="one"><img src="/y.png" alt="two">';
    const md = toMarkdown(two, { images: 'reference', url: pageUrl });
    expect(md).toContain('![one][img-1]');
    expect(md).toContain('![two][img-2]');
    expect(md).toMatch(/\[img-1\]: https:\/\/example\.com\/x\.png/);
    expect(md).toMatch(/\[img-2\]: https:\/\/example\.com\/y\.png/);
  });
});

describe('anchor absolutization', () => {
  it('absolutizes a relative href against url', () => {
    const md = toMarkdown('<a href="/rel">text</a>', { url: pageUrl });
    expect(md).toContain('[text](https://example.com/rel)');
  });

  it('absolutizes both a relative anchor and an image together', () => {
    const md = toMarkdown(
      '<a href="/rel">text</a> and <img src="/a.png" alt="d">',
      { images: 'keep', url: pageUrl },
    );
    expect(md).toContain('[text](https://example.com/rel)');
    expect(md).toContain('![d](https://example.com/a.png)');
  });

  it('leaves an already-absolute href unchanged', () => {
    const md = toMarkdown('<a href="https://other.test/abs">abs</a>', {
      url: pageUrl,
    });
    expect(md).toContain('[abs](https://other.test/abs)');
  });

  it('preserves the title attribute', () => {
    const md = toMarkdown('<a href="/x" title="t">text</a>', { url: pageUrl });
    expect(md).toContain('[text](https://example.com/x "t")');
  });

  it('leaves the href as-is when no url option is provided', () => {
    const md = toMarkdown('<a href="/rel">text</a>');
    expect(md).toContain('[text](/rel)');
  });

  it('still renders an image (with absolute src) when the anchor wraps it', () => {
    const md = toMarkdown('<a href="/lnk"><img src="/a.png" alt="d"></a>', {
      images: 'keep',
      url: pageUrl,
    });
    expect(md).toContain('[![d](https://example.com/a.png)](https://example.com/lnk)');
  });

  it('returns bare content when href is empty (matches turndown default)', () => {
    const md = toMarkdown('<a href="">empty</a>', { url: pageUrl });
    expect(md.trim()).toBe('empty');
  });
});

describe('turndown tables option', () => {
  const rowspanHtml =
    '<table><thead><tr><th>K</th><th>V</th></tr></thead>' +
    '<tbody><tr><td rowspan="2">shared</td><td>a</td></tr>' +
    '<tr><td>b</td></tr></tbody></table>';

  it('renders a fenced csv block with the rowspan resolved when tables=csv', () => {
    const md = toMarkdown(rowspanHtml, { tables: 'csv' });
    expect(md).toContain('```csv');
    // The rowspan leaves the skipped cell empty, not repeated.
    expect(md).toContain('K,V');
    expect(md).toContain('shared,a');
    expect(md).toContain(',b');
  });

  it('renders a fenced json block when tables=json', () => {
    const md = toMarkdown(rowspanHtml, { tables: 'json' });
    expect(md).toContain('```json');
    const fenced = md.match(/```json\n([\s\S]+?)\n```/);
    expect(fenced).not.toBeNull();
    const records = JSON.parse(fenced![1]!) as Record<string, string>[];
    expect(records).toEqual([
      { K: 'shared', V: 'a' },
      { K: '', V: 'b' },
    ]);
  });

  it('renders a native GFM table when tables=gfm', () => {
    const md = toMarkdown(rowspanHtml, { tables: 'gfm' });
    expect(md).not.toContain('```');
    expect(md).toContain('| K | V |');
    expect(md).toContain('| --- | --- |');
    expect(md).toContain('| shared | a |');
  });

  it('leaves the stock gfm plugin handling tables when tables is unset (default unchanged)', () => {
    const md = toMarkdown(
      '<table><thead><tr><th>H1</th><th>H2</th></tr></thead>' +
        '<tbody><tr><td>1</td><td>2</td></tr></tbody></table>',
    );
    expect(md).toContain('| H1 | H2 |');
    expect(md).toContain('| --- | --- |');
    expect(md).not.toContain('```');
  });
});

describe('footnote collection', () => {
  it('emits inline [^N] markers and appends a definitions block when refs+defs are paired', () => {
    const html =
      '<p>Claim one<sup><a href="#fn-1">1</a></sup> and claim two<sup><a href="#fn-2">2</a></sup>.</p>' +
      '<ol class="footnotes"><li id="fn-1">First note</li><li id="fn-2">Second note</li></ol>';
    const md = toMarkdown(html, { url: pageUrl });
    expect(md).toContain('Claim one[^1]');
    expect(md).toContain('claim two[^2]');
    expect(md).toMatch(/\[\^1\]: First note/);
    expect(md).toMatch(/\[\^2\]: Second note/);
    // turndown must not backslash-escape the emitted markers.
    expect(md).not.toContain('\\[^1\\]');
    expect(md).not.toContain('\\[^2\\]');
  });

  it('produces no footnote markers when the input has no footnote markup (default unchanged)', () => {
    const md = toMarkdown(
      '<p>Plain paragraph with a <sup>2</sup> superscript.</p>',
      { url: pageUrl },
    );
    expect(md).not.toContain('[^');
    expect(md).toContain('Plain paragraph');
  });
});
