import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

export type CodeBlockStyle = 'fenced' | 'indented';
export type HeadingStyle = 'atx' | 'setext';
export type ImageMode = 'drop' | 'keep' | 'reference' | 'src-only';

export interface TurndownOptions {
  readonly codeBlockStyle?: CodeBlockStyle;
  readonly gfm?: boolean;
  readonly headingStyle?: HeadingStyle;
  readonly images?: ImageMode;
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

  const body = service.turndown(html);
  if (imageMode === 'reference' && references.length > 0) {
    const refBlock = references
      .map((ref, i) => `[img-${i + 1}]: ${ref}`)
      .join('\n');
    return `${body.replace(/\n+$/, '')}\n\n${refBlock}`;
  }
  return body;
}

function absolutize(src: string, baseUrl: string | undefined): string {
  if (!src || !baseUrl) {
    return src;
  }
  try {
    return new URL(src, baseUrl).href;
  } catch {
    return src;
  }
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
