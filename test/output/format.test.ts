import { htmlToMarkdownFromHtml } from '../../src/tools/html_to_markdown.js';

describe('frontmatter token estimate', () => {
  it('yaml frontmatter includes tokenEstimate and estimator lines', () => {
    const result = htmlToMarkdownFromHtml({
      html: '<h2>Heading</h2><p>some fragment text here</p>',
      baseUrl: 'https://x.example/',
      metadataMode: 'yaml',
    });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toMatch(/^tokenEstimate: \d+$/m);
    expect(text).toMatch(/^estimator: chars\/4$/m);
  });

  it('json frontmatter includes tokenEstimate and estimator fields', () => {
    const result = htmlToMarkdownFromHtml({
      html: '<h2>Heading</h2><p>some fragment text here</p>',
      baseUrl: 'https://x.example/',
      metadataMode: 'json',
    });
    const text = (result.content[0] as { text: string }).text;
    const fenced = text.match(/```json\n([\s\S]*?)\n```/);
    expect(fenced).not.toBeNull();
    const picked = JSON.parse(fenced![1]) as {
      estimator?: string;
      tokenEstimate?: number;
    };
    expect(typeof picked.tokenEstimate).toBe('number');
    expect(picked.estimator).toBe('chars/4');
  });
});
