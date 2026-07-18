import { stringify as stringifyYaml } from 'yaml';

import type { Diagnostics, Metadata } from '../pipeline/context.js';

import { headingText, parseBlocks } from '../policy/markdown.js';

export type Format = 'html' | 'json' | 'markdown' | 'text';
export type MetadataMode = 'json' | 'none' | 'yaml';

export interface FormatInput {
  readonly diagnostics: Diagnostics;
  readonly format: Format;
  readonly markdown: string;
  readonly metadata: Metadata;
  readonly metadataMode: MetadataMode;
  readonly sanitizedHtml: string;
  readonly textContent: string;
}

interface JsonObject {
  readonly content: string;
  readonly diagnostics: Diagnostics;
  readonly metadata: Metadata;
}

// Readability demotes the article <h1> to <h2> inside `content` and mirrors its
// text into the title; drop the echoed sub-heading so the title prints once.
function dropEchoedTitle(body: string, title: string): string {
  const blocks = parseBlocks(body);
  if (blocks.length === 0) {
    return body;
  }
  const first = blocks[0];
  if (
    first.kind === 'heading' &&
    headingText(body.slice(first.start, first.end)) === title.trim()
  ) {
    return body.slice(first.end).replace(/^\n+/, '');
  }
  return body;
}

function renderMarkdown(input: Readonly<FormatInput>): string {
  const title = input.metadata.title?.trim();
  let body = input.markdown;
  if (title) {
    body = dropEchoedTitle(body, title);
    return `# ${title}\n\n${body}`.replace(/\n+$/, '\n');
  }
  return body.replace(/\n+$/, '\n');
}

// Stable key order for deterministic frontmatter. `structured` is deliberately
// absent: it is a nested object, not a scalar, and would dump a whole JSON-LD
// graph into frontmatter. It reaches the host via format=json and
// structuredContent.metadata, which serialize the full metadata object.
const METADATA_KEYS = [
  'title',
  'byline',
  'siteName',
  'lang',
  'publishedTime',
  'excerpt',
  'canonical',
  'url',
  'wordCount',
  'readingTimeMin',
  'tokenEstimate',
  'estimator',
] as const satisfies readonly (keyof Metadata)[];

function pickMetadata(
  metadata: Readonly<Metadata>,
): Record<string, number | string> {
  const picked: Record<string, number | string> = {};
  for (const key of METADATA_KEYS) {
    const value = metadata[key];
    if (value !== undefined) {
      picked[key] = value;
    }
  }
  return picked;
}

// lineWidth: 0 disables folding so each field stays on one line.
function yamlFrontmatter(metadata: Readonly<Metadata>): string {
  return `---\n${stringifyYaml(pickMetadata(metadata), { lineWidth: 0 })}---\n`;
}

function jsonFrontmatter(metadata: Readonly<Metadata>): string {
  return (
    '```json\n' + JSON.stringify(pickMetadata(metadata), null, 2) + '\n```\n'
  );
}

function withFrontmatter(
  payload: string,
  mode: MetadataMode,
  metadata: Readonly<Metadata>,
): string {
  if (mode === 'yaml') {
    return `${yamlFrontmatter(metadata)}${payload}`;
  }
  if (mode === 'json') {
    return `${jsonFrontmatter(metadata)}\n${payload}`;
  }
  return payload;
}

export function formatPayload(input: Readonly<FormatInput>): string {
  let payload: string;
  switch (input.format) {
    case 'html':
      return input.sanitizedHtml;
    case 'json': {
      const body: JsonObject = {
        metadata: input.metadata,
        content: input.markdown,
        diagnostics: input.diagnostics,
      };
      return JSON.stringify(body, null, 2);
    }
    case 'text':
      payload = input.textContent;
      break;
    case 'markdown':
    default:
      payload = renderMarkdown(input);
      break;
  }
  return withFrontmatter(payload, input.metadataMode, input.metadata);
}
