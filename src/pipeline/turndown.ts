import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

import type { TableFormat } from '../policy/tables.js';

import { processFootnotes } from '../policy/footnotes.js';
import { parseTableMatrix, renderTable } from '../policy/tables.js';
import { absolutize } from './urls.js';

export type CodeBlockStyle = 'fenced' | 'indented';
export type HeadingStyle = 'atx' | 'setext';
export type ImageMode = 'drop' | 'keep' | 'reference' | 'src-only';
export type { TableFormat };

export interface TurndownOptions {
  readonly codeBlockStyle?: CodeBlockStyle;
  readonly gfm?: boolean;
  readonly headingStyle?: HeadingStyle;
  readonly images?: ImageMode;
  readonly tables?: TableFormat;
  readonly url?: string;
}

export function toMarkdown(
  html: string,
  options?: Readonly<TurndownOptions>,
): string {
  const service = new TurndownService({
    bulletListMarker: '-',
    codeBlockStyle: options?.codeBlockStyle ?? 'fenced',
    emDelimiter: '_',
    fence: '```',
    headingStyle: options?.headingStyle ?? 'atx',
    strongDelimiter: '**',
  });

  if (options?.gfm !== false) {
    service.use(gfm);
  }

  const tableFormat = options?.tables;
  if (tableFormat !== undefined) {
    // addRule prepends, so this shadows the gfm plugin's table rule AND its
    // headerless-table keep filter (which lives in a separate _keep list, only
    // consulted when no rule in the array matches). Matching every TABLE here
    // means the keep list is never reached for tables.
    service.addRule('tableMatrix', {
      filter: node => node.nodeName === 'TABLE',
      replacement: (_content, node) => {
        const matrix = parseTableMatrix(node);
        if (matrix.length === 0) {
          return '';
        }
        const body = renderTable(matrix, tableFormat);
        // GFM rows are already markdown table syntax; csv/json need a fenced block.
        if (tableFormat === 'gfm') {
          return `\n\n${body}\n\n`;
        }
        return `\n\n\`\`\`${tableFormat}\n${body}\n\`\`\`\n\n`;
      },
    });
  }

  const imageMode = options?.images;
  const baseUrl = options?.url;
  // `reference` mode collects definitions as images render; append them after the pass.
  const references: string[] = [];
  applyImagePolicy(service, imageMode, baseUrl, references);
  // Readability pre-absolutizes anchors on the main path, but html_to_markdown
  // and the extract fallback bypass it; turndown is shared, so absolutize here
  // for every path. Empty/absent href falls through to bare content to match
  // turndown's default link rule (which never matches when href is falsy).
  service.addRule('anchorAbsolutize', {
    filter: 'a',
    replacement: (content, node) => {
      const rawHref = node.getAttribute('href');
      if (!rawHref) {
        return content;
      }
      const href = absolutize(rawHref, baseUrl);
      const title = node.getAttribute('title');
      const titlePart = title ? ` "${title.replace(/"/g, '\\"')}"` : '';
      return `[${content}](${href}${titlePart})`;
    },
  });
  // Math markers are emitted by `policy/math.ts` and survive Readability via the
  // `rdrm-math` preserve entry. A rule's replacement is inserted verbatim, so
  // the raw LaTeX backslashes survive turndown untouched.
  service.addRule('mathMarker', {
    filter: node =>
      node.nodeName === 'SPAN' && node.classList.contains('rdrm-math'),
    replacement: (_content, node) => {
      const tex = node.textContent.trim();
      if (!tex) {
        return '';
      }
      const display = node.getAttribute('data-display') === 'true';
      return display ? `$$${tex}$$` : `$${tex}$`;
    },
  });

  const fnResult = processFootnotes(html);
  const sourceHtml = fnResult?.html ?? html;
  let body = service.turndown(sourceHtml);

  if (fnResult) {
    // Turndown sees `[^N]` as a shortcut-reference link and backslash-escapes
    // the brackets; reverse that for the markers we emitted so they render as
    // footnote refs. Code blocks pass through verbatim and never carry the
    // escape, so they are unaffected.
    for (let n = 1; n <= fnResult.footnoteDefs.length; n++) {
      body = body.replaceAll(`\\[^${n}\\]`, `[^${n}]`);
    }
  }

  const trailingBlocks: string[] = [];
  if (imageMode === 'reference' && references.length > 0) {
    trailingBlocks.push(
      references.map((ref, i) => `[img-${i + 1}]: ${ref}`).join('\n'),
    );
  }
  if (fnResult && fnResult.footnoteDefs.length > 0) {
    trailingBlocks.push(
      fnResult.footnoteDefs.map((def, i) => `[^${i + 1}]: ${def}`).join('\n'),
    );
  }
  if (trailingBlocks.length === 0) {
    return body;
  }
  return `${body.replace(/\n+$/, '')}\n\n${trailingBlocks.join('\n')}`;
}

function applyImagePolicy(
  service: TurndownService,
  mode: ImageMode | undefined,
  baseUrl: string | undefined,
  references: string[],
): void {
  switch (mode) {
    case 'drop': {
      // `.remove('img')` doesn't reliably drop void elements in turndown 7.x.
      service.addRule('dropImage', {
        filter: 'img',
        replacement: () => '',
      });
      break;
    }
    case 'keep':
    case undefined: {
      service.addRule('imageKeep', {
        filter: 'img',
        replacement: (_content, node) => {
          const src = absolutize(node.getAttribute('src') ?? '', baseUrl);
          const alt = node.getAttribute('alt') ?? '';
          return src ? `![${alt}](${src})` : '';
        },
      });
      break;
    }
    case 'reference': {
      service.addRule('imageReference', {
        filter: 'img',
        replacement: (_content, node) => {
          const src = absolutize(node.getAttribute('src') ?? '', baseUrl);
          if (!src) {
            return '';
          }
          references.push(src);
          const id = references.length;
          const alt = node.getAttribute('alt') ?? '';
          return `![${alt}][img-${id}]`;
        },
      });
      break;
    }
    case 'src-only': {
      service.addRule('imageSrcOnly', {
        filter: 'img',
        replacement: (_content, node) => {
          const src = absolutize(node.getAttribute('src') ?? '', baseUrl);
          return src ? `\n\n${src}\n\n` : '';
        },
      });
      break;
    }
  }
}
