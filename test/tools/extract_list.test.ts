import { extractListFromHtml } from '../../src/tools/extract_list.js';
import { extractListOutput } from '../../src/tools/output-schema.js';

const ORIGIN = 'https://example.com/';

describe('extract_list tool', () => {
  // The detector is comparative — "the cluster with the most items wins" — so
  // without a scope it returns feed-a (4 items > feed-b's 3). selectors.include
  // narrows the body first: an "I know which list I want" escape hatch that
  // subverts the cross-cluster comparison by design.
  it('selectors.include picks which list the comparative detector scores', () => {
    const html =
      '<div id="feed-a"><ul>' +
      '<li><a href="/a1">Alpha One</a></li>' +
      '<li><a href="/a2">Alpha Two</a></li>' +
      '<li><a href="/a3">Alpha Three</a></li>' +
      '<li><a href="/a4">Alpha Four</a></li>' +
      '</ul></div>' +
      '<div id="feed-b"><ul>' +
      '<li><a href="/b1">Beta One</a></li>' +
      '<li><a href="/b2">Beta Two</a></li>' +
      '<li><a href="/b3">Beta Three</a></li>' +
      '</ul></div>';

    const unscoped = extractListFromHtml({ html, baseUrl: ORIGIN });
    const unscopedParsed = extractListOutput.parse(unscoped.structuredContent);
    expect(unscopedParsed.diagnostics.detected).toBe(true);
    expect(unscopedParsed.items.map(i => i.url)).toEqual(
      expect.arrayContaining([
        `${ORIGIN}a1`,
        `${ORIGIN}a2`,
        `${ORIGIN}a3`,
        `${ORIGIN}a4`,
      ]),
    );
    expect(
      unscopedParsed.items.every(
        i => !/\/b[123]$/.test(new URL(i.url).pathname),
      ),
    ).toBe(true);

    const scoped = extractListFromHtml({
      html,
      baseUrl: ORIGIN,
      selectors: { include: '#feed-b' },
    });
    const scopedParsed = extractListOutput.parse(scoped.structuredContent);
    expect(scopedParsed.items.map(i => i.url)).toEqual([
      `${ORIGIN}b1`,
      `${ORIGIN}b2`,
      `${ORIGIN}b3`,
    ]);
  });
});
