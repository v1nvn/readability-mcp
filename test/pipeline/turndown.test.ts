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
