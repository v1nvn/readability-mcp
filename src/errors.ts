import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export interface TextContent {
  readonly text: string;
  readonly type: 'text';
}

export interface ErrorResult {
  // Mutable so the literal assigns to the SDK's CallToolResult (mutable content).
  readonly content: TextContent[];
  readonly isError: true;
}

export class ExtractionError extends Error {
  public override readonly cause: unknown;

  public constructor(message: string, options: { cause?: unknown } = {}) {
    super(message);
    this.name = 'ExtractionError';
    this.cause = options.cause;
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

export function toErrorResult(err: unknown): CallToolResult {
  const label = err instanceof ExtractionError ? err.name : 'Error';
  return {
    isError: true,
    content: [{ type: 'text', text: `${label}: ${describeError(err)}` }],
  };
}
