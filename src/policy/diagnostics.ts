import type {
  Diagnostics,
  SanitizationDiagnostics,
} from '../pipeline/context.js';
import type { GatingSignal } from './gating.js';
import type { PaginationSignal } from './pagination.js';

export interface DiagnosticsInput {
  readonly articleHtml?: string;
  readonly boilerplateRemoved?: number;
  readonly chromeRemoved?: number;
  readonly document?: Document;
  readonly documentElementCount?: number;
  readonly extractedNode?: string;
  readonly fallbackUsed?: boolean;
  readonly gated?: GatingSignal;
  readonly imagesResolved?: number;
  readonly pagination?: PaginationSignal;
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
    gated: input.gated,
    imagesResolved: input.imagesResolved,
    pagination: input.pagination,
    removedNodes,
    boilerplateRemoved: input.boilerplateRemoved,
    chromeRemoved: input.chromeRemoved,
    sanitization: input.sanitization,
    truncated: input.truncated ?? false,
  };
}
