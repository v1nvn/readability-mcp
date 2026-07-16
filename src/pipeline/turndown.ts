// Turndown HTML→Markdown (DESIGN §6.3). Turndown is DOM-agnostic (it ships its
// own domino parser) and takes an HTML string, so it consumes the sanitized
// article HTML directly — no jsdom bridge. We apply the GFM plugin (tables,
// strikethrough, task lists) and custom rules for the `images` option.

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
  // `reference` mode collects link-ref definitions as images render, so the
  // turndown pass must run through this closure before we append them.
  const references: string[] = [];
  applyImagePolicy(service, imageMode, baseUrl, references);

  const body = service.turndown(html);
  if (imageMode === 'reference' && references.length > 0) {
    const refBlock = references
      .map((ref, i) => `[img-${i + 1}]: ${ref}`)
      .join('\n');
    return `${body.replace(/\n+$/, '')}\n\n${refBlock}`;
  }
  return body;
}

// Resolve a src against the optional origin so images are absolute even on the
// fallback / fragment paths where Readability (which absolutizes `<img src>` in
// `article.content`) never ran. Idempotent for already-absolute URLs.
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
      // `.remove('img')` does not reliably drop void elements in turndown 7.x,
      // so register an explicit empty-replacement rule for <img>.
      service.addRule('dropImage', {
        filter: 'img',
        replacement: () => '',
      });
      break;
    }
    case 'keep':
    case undefined: {
      // Override turndown's default image rule so the `url` origin absolutizes
      // relative src values uniformly (extract path is idempotent — Readability
      // already absolutized).
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
      // Markdown reference-style image: `![alt][img-N]` with a `[img-N]: url`
      // link-ref block appended once the turndown pass completes.
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
      // Alt is dropped; emit just the bare absolute URL on its own line so the
      // source survives for downstream consumers without inline image syntax.
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
