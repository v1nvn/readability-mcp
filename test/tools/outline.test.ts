import { outlineDocument } from '../../src/tools/outline.js';
import { outlineOutput } from '../../src/tools/output-schema.js';

describe('outline tool', () => {
  it('selectors.include scopes the heading walk to a subtree', () => {
    const html =
      '<nav><h2>Nav Heading</h2></nav>' +
      '<main><h1>Title</h1><h2>Section</h2></main>';
    const result = outlineDocument({ html, selectors: { include: 'main' } });
    const parsed = outlineOutput.parse(result.structuredContent);
    expect(parsed.outline.map(o => o.text)).toEqual(['Title', 'Section']);
  });
});
