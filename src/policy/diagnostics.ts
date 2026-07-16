// Assemble the Diagnostics object from stage outputs (DESIGN §5.1, §6.1).
// `fallbackUsed` / `truncated` are decided by the caller (the selector cascade
// and the truncation step) and passed in; this module only shapes the object.
// `removedNodes` is the element-delta between the document and the extracted
// article HTML — the "noise Readability stripped" signal.

import type {
  Diagnostics,
  SanitizationDiagnostics,
} from '../pipeline/context.js';

export interface DiagnosticsInput {
  readonly articleHtml?: string;
  readonly document?: Document;
  readonly documentElementCount?: number;
  readonly extractedNode?: string;
  readonly fallbackUsed?: boolean;
  readonly readerable?: boolean;
  readonly sanitization?: SanitizationDiagnostics;
  readonly truncated?: boolean;
  readonly window?: Window;
}

function countElements(html: string, window?: Window): number {
  if (!window || !html) {
    return 0;
  }
  // Parse the article fragment in the same window to count its element nodes.
  const template = window.document.createElement('div');
  template.innerHTML = html;
  return template.querySelectorAll('*').length;
}

export function assembleDiagnostics(
  input: Readonly<DiagnosticsInput>,
): Diagnostics {
  const articleElementCount = countElements(
    input.articleHtml ?? '',
    input.window,
  );
  const removedNodes = Math.max(
    0,
    (input.documentElementCount ?? 0) - articleElementCount,
  );

  return {
    readerable: input.readerable,
    extractedNode: input.extractedNode,
    fallbackUsed: input.fallbackUsed ?? false,
    removedNodes,
    sanitization: input.sanitization,
    truncated: input.truncated ?? false,
  };
}
