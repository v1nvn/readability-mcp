// Typed extraction errors + translation into MCP tool results.
//
// Nothing here throws across the wire: tool handlers catch and convert to an
// `{ isError: true }` result so clients always see a structured response.

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export interface TextContent {
  readonly text: string;
  readonly type: 'text';
}

// Shape of an error result. Kept as an interface for documentation and for the
// `toErrorResult` return annotation (the SDK's CallToolResult adds a string
// index signature that makes field access `unknown`; we keep this narrower).
export interface ErrorResult {
  // Mutable so the object literal is assignable to the SDK's CallToolResult,
  // whose `content` is a mutable array of content-variant objects.
  readonly content: TextContent[];
  readonly isError: true;
}

// Base for all extraction-stage failures. Subclass per stage in later phases;
// the `cause` chain preserves the original error for diagnostics.
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

// Normalize any thrown value into the MCP error-result shape. Tool handlers
// wrap their bodies in try/catch and pass the caught value here. Returned as
// CallToolResult so it satisfies the SDK's tool-callback return contract
// (CallToolResult carries a string index signature; the object literal we build
// here satisfies it without weakening call-site typing).
export function toErrorResult(err: unknown): CallToolResult {
  const label = err instanceof ExtractionError ? err.name : 'Error';
  return {
    isError: true,
    content: [{ type: 'text', text: `${label}: ${describeError(err)}` }],
  };
}
