import { readFileSync } from 'node:fs';

export function readHtmlFile(localPath: string): string {
  return readFileSync(localPath, 'utf8');
}
