import type {
  CacheSignal,
  Diagnostics,
  SanitizationDiagnostics,
  TraceStage,
} from '../pipeline/context.js';
import type { GatingSignal } from './gating.js';
import type { PaginationSignal } from './pagination.js';

export interface DiagnosticsInput {
  readonly articleHtml?: string;
  readonly boilerplateRemoved?: number;
  readonly cache?: CacheSignal;
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
  readonly trace?: readonly TraceStage[];
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
    trace: input.trace,
    truncated: input.truncated ?? false,
    ...(input.cache ? { cache: input.cache } : {}),
  };
}

// Emits trace entries only when enabled, so the debug-off hot path allocates
// nothing (the fn runs bare). Used by the orchestrator tools to time pipeline
// stages without threading timers into lower layers.
export class TraceCollector {
  private readonly enabled: boolean;
  private readonly entries: TraceStage[] = [];

  constructor(enabled: boolean) {
    this.enabled = enabled;
  }

  collect(): readonly TraceStage[] | undefined {
    return this.enabled ? this.entries : undefined;
  }

  run<T>(stage: string, fn: () => T): T {
    if (!this.enabled) {
      return fn();
    }
    const start = performance.now();
    try {
      return fn();
    } finally {
      this.entries.push({ ms: performance.now() - start, stage });
    }
  }
}
