import { readFileSync } from 'node:fs';

export function readHtmlFile(localPath: string): string {
  const raw = readFileSync(localPath, 'utf8');
  const trimmed = raw.trim();
  // A top-level JSON string scalar is a chrome-devtools capture (its JSON-encoded
  // return value written to disk), not raw markup — unwrap it before parsing.
  if (trimmed.length < 2 || trimmed.at(0) !== '"' || trimmed.at(-1) !== '"') {
    return raw;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return typeof parsed === 'string' ? parsed : raw;
  } catch {
    return raw;
  }
}
