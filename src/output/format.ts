// Render the text payload (DESIGN §5.1). The format selects what becomes
// `content[0].text`:
//   - markdown: turndown output, with the article title prepended as `#`.
//   - html:     sanitized article HTML.
//   - text:     plain textContent.
//   - json:     pretty JSON of { metadata, content, diagnostics } — the one
//               case where JSON-in-text is intentional.
// `metadataMode` prepends a YAML or JSON frontmatter block to the markdown/text
// payload (none = plain). `structuredContent.metadata` is always present
// regardless of `metadataMode`, so this is purely a rendering convenience for
// the human/LLM-readable text.

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

// Readability demotes the article's <h1> to <h2> inside `content` and mirrors
// its text into `article.title`. So the turndown body opens with "## <title>"
// right after we prepend "# <title>". Drop that echoed sub-heading so the
// article's title is printed exactly once, as the document's sole top-level
// heading.
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

// Double-quote string scalars so YAML frontmatter is always well-formed
// regardless of the value (handles colons, leading '#', quotes, etc.).
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

// Stable key order so frontmatter output is deterministic across Node versions.
const METADATA_KEYS: readonly (keyof Metadata)[] = [
  'title',
  'byline',
  'siteName',
  'lang',
  'publishedTime',
  'excerpt',
  'url',
  'wordCount',
  'readingTimeMin',
];

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

// Prepend the chosen frontmatter block to a text-ish payload. Only applies to
// markdown/text — html is raw markup and json already carries metadata.
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
