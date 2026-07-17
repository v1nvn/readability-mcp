import type { Diagnostics, Metadata } from '../pipeline/context.js';

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
  const lines = body.split('\n');
  const first = lines[0];
  const match = /^#{1,6}\s+(.+?)\s*$/.exec(first);
  if (match?.[1]?.trim() === title.trim()) {
    const rest = lines.slice(1);
    if (rest[0] === '') {
      rest.shift();
    }
    return rest.join('\n');
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

function yamlScalar(value: number | string): string {
  if (typeof value === 'number') {
    return String(value);
  }
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, ' ');
  return `"${escaped}"`;
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

function yamlFrontmatter(metadata: Readonly<Metadata>): string {
  const lines: string[] = ['---'];
  for (const key of METADATA_KEYS) {
    const value = metadata[key];
    if (value === undefined) {
      continue;
    }
    lines.push(`${key}: ${yamlScalar(value)}`);
  }
  lines.push('---', '');
  return lines.join('\n');
}

function jsonFrontmatter(metadata: Readonly<Metadata>): string {
  const picked: Record<string, number | string> = {};
  for (const key of METADATA_KEYS) {
    const value = metadata[key];
    if (value !== undefined) {
      picked[key] = value;
    }
  }
  return '```json\n' + JSON.stringify(picked, null, 2) + '\n```\n';
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
