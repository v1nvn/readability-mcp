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
  readonly imagesResolved?: number;
  readonly readerable?: boolean;
  readonly sanitization?: SanitizationDiagnostics;
  readonly truncated?: boolean;
  readonly window?: Window;
}

function countElements(html: string, window?: Window): number {
  if (!window || !html) {
    return 0;
  }
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
    imagesResolved: input.imagesResolved,
    removedNodes,
    sanitization: input.sanitization,
    truncated: input.truncated ?? false,
  };
}
