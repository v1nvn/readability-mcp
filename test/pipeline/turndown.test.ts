// Turndown image-mode unit tests (DESIGN §5.1 `images` option). Covers the
// keep/drop (existing) and the Phase C src-only/reference renderings.

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
