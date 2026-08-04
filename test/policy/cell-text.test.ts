import { buildDocument } from '../../src/pipeline/dom.js';
import { resolveCellText } from '../../src/policy/cell-text.js';

function cell(html: string): Element {
  // Bare <td>/<th> in <body> have their tags dropped by the HTML parser, and a
  // <div>/<a> in <tr> gets foster-parented out of the table — so pick a wrapper
  // the parser will keep intact for the cell's tag.
  const isTableCell = /^<(td|th)\b/i.test(html);
  const body = isTableCell
    ? `<table><tbody><tr>${html}</tr></tbody></table>`
    : html;
  const { document } = buildDocument(`<html><body>${body}</body></html>`);
  const el = document.querySelector('[data-cell]');
  if (!el) {
    throw new Error(`fixture needs a [data-cell] element: ${html}`);
  }
  return el;
}

describe('policy.cellText resolveCellText', () => {
  it('normalizes whitespace and trims', () => {
    const el = cell(
      '<td data-cell>\n  hello\n  world  </td>',
    );
    expect(resolveCellText(el)).toBe('hello world');
  });

  it('strips badge and aria chrome when other text remains', () => {
    const el = cell(
      '<td data-cell><span>Market Capitalization</span>' +
        '<span class="badge">Market Leader</span>' +
        '<span aria-label="x">Unavailable</span></td>',
    );
    expect(resolveCellText(el)).toBe('Market Capitalization');
  });

  it('keeps the text when chrome holds the only content (never-empty guard)', () => {
    // The cell's entire visible word sits inside the stripped wrapper — stripping
    // would empty it, so the guard falls back to the full text.
    const el = cell(
      '<td data-cell><span class="text-capitalize" data-tooltip="tooltip" ' +
        'data-original-title="promoters"><span class="text-capitalize">promoters</span></span></td>',
    );
    expect(resolveCellText(el)).toBe('promoters');
  });

  it('keeps a sole badge value (guard)', () => {
    const el = cell('<td data-cell><span class="badge">5</span></td>');
    expect(resolveCellText(el)).toBe('5');
  });

  it('falls back to an anchor href when the cell has no visible text', () => {
    // Icon-only link: the URL lives in href, the <svg> carries no text node.
    const el = cell(
      '<td data-cell><a target="_blank" href="https://example.com/r.pdf">' +
        '<span data-tooltip="tooltip" data-original-title="View Report">' +
        '<svg aria-hidden="true" viewBox="0 0 16 16"><path d="M0 0"/></svg>' +
        '</span></a></td>',
    );
    expect(resolveCellText(el)).toBe('https://example.com/r.pdf');
  });

  it('does not prefer href when the cell has visible text', () => {
    const el = cell(
      '<td data-cell><a href="https://example.com">Report</a></td>',
    );
    expect(resolveCellText(el)).toBe('Report');
  });

  it('joins multiple hrefs when the cell holds several icon links', () => {
    const el = cell(
      '<div data-cell><a href="https://a.com/x.pdf"><svg/></a>' +
        '<a href="https://b.com/y.pdf"><svg/></a></div>',
    );
    expect(resolveCellText(el)).toBe(
      'https://a.com/x.pdf https://b.com/y.pdf',
    );
  });

  it('uses the href when the cell itself is the anchor (grid link cell)', () => {
    const el = cell('<a data-cell href="https://example.com/doc"></a>');
    expect(resolveCellText(el)).toBe('https://example.com/doc');
  });

  it('returns empty for a truly empty cell with no link', () => {
    expect(resolveCellText(cell('<td data-cell></td>'))).toBe('');
  });

  it('ignores empty href attributes', () => {
    const el = cell('<td data-cell><a href=""><svg/></a></td>');
    expect(resolveCellText(el)).toBe('');
  });
});
