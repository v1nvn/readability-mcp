import { readFileSync } from 'node:fs';

import { extractArticle } from './tools/extract.js';

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Readable } from 'node:stream';

type CliFormat = 'html' | 'json' | 'md';

export interface ParsedArgs {
  readonly file: string | undefined;
  readonly format: CliFormat;
  readonly maxChars: number | undefined;
  readonly stdin: boolean;
}

const USAGE =
  'Usage: readability-mcp extract [file.html] [--format md|json|html] [--max-chars N] [--stdin]';

const FORMATS: readonly CliFormat[] = ['html', 'json', 'md'];

function isCliFormat(value: string | undefined): value is CliFormat {
  return value !== undefined && (FORMATS as readonly string[]).includes(value);
}

// `extract` is consumed by the caller; everything after it is parsed here.
// Flag values are read with `.at()` (not `[]`) because the peek may advance
// past the end for a trailing flag with no value; `.at()` surfaces that as
// undefined where bracket indexing would not (noUncheckedIndexedAccess is off).
export function parseArgs(argv: readonly string[]): ParsedArgs | undefined {
  let file: string | undefined;
  let format: CliFormat = 'md';
  let maxChars: number | undefined;
  let stdin = false;

  const rest = argv.slice(1);
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--format') {
      const value = rest.at(++i);
      if (!isCliFormat(value)) {
        return undefined;
      }
      format = value;
    } else if (arg === '--max-chars') {
      const value = rest.at(++i);
      if (value === undefined) {
        return undefined;
      }
      const n = Number(value);
      if (!Number.isInteger(n)) {
        return undefined;
      }
      maxChars = n;
    } else if (arg === '--stdin') {
      stdin = true;
    } else if (arg.startsWith('--')) {
      return undefined;
    } else if (file === undefined) {
      file = arg;
    } else {
      return undefined;
    }
  }

  return { file, format, maxChars, stdin };
}

// `--stdin` is a discoverability alias; stdin is already the default when no
// file is given, so the reader branches on `file` alone. The stream is injected
// rather than reading process.stdin directly so the path is testable. Chunks
// may be Buffer (process.stdin) or string (Readable.from), so both are handled.
export async function readHtml(
  file: string | undefined,
  stream: Readable,
): Promise<string> {
  if (file !== undefined) {
    return readFileSync(file, 'utf8');
  }
  const chunks: string[] = [];
  for await (const chunk of stream) {
    if (typeof chunk === 'string') {
      chunks.push(chunk);
    } else {
      chunks.push(Buffer.from(chunk as Uint8Array).toString('utf8'));
    }
  }
  return chunks.join('');
}

function payloadText(result: CallToolResult): string {
  const first = result.content.at(0);
  return first !== undefined && 'text' in first ? first.text : '';
}

export async function runCli(argv: readonly string[]): Promise<number> {
  if (argv[0] !== 'extract') {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }

  const parsed = parseArgs(argv);
  if (parsed === undefined) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }

  try {
    const html = await readHtml(parsed.file, process.stdin);
    // json reuses the markdown pipeline; the structured object is serialized below.
    const pipelineFormat = parsed.format === 'html' ? 'html' : 'markdown';
    const result = extractArticle({
      html,
      format: pipelineFormat,
      ...(parsed.maxChars !== undefined ? { maxChars: parsed.maxChars } : {}),
    });

    if (result.isError) {
      process.stderr.write(`${payloadText(result)}\n`);
      return 1;
    }

    if (parsed.format === 'json') {
      process.stdout.write(
        `${JSON.stringify(result.structuredContent, null, 2)}\n`,
      );
    } else {
      process.stdout.write(`${payloadText(result)}\n`);
    }
    return 0;
  } catch (err) {
    process.stderr.write(
      `${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }
}
