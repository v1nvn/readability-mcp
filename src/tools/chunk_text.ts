import type { Chunk } from '../policy/chunk.js';
import type { ToolHandle } from '../server.js';

import { toErrorResult } from '../errors.js';
import { logger } from '../logger.js';
import { chunkMarkdown } from '../policy/chunk.js';
import { chunkTextOutputShape } from './output-schema.js';
import { chunkTextInputSchema, chunkTextInputShape } from './schemas.js';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// One numbered section per chunk, heading context in brackets when present, so
// content[0].text is always scannable without unpacking structuredContent.
function renderChunkIndex(chunks: readonly Chunk[]): string {
  if (chunks.length === 0) {
    return '(no chunks emitted — input had no non-whitespace content)';
  }
  return chunks
    .map(chunk => {
      const head = chunk.headingContext ? ` [${chunk.headingContext}]` : '';
      return `## Chunk ${chunk.index}${head}\n\n${chunk.text}`;
    })
    .join('\n\n');
}

export function chunkTextDocument(rawArgs: unknown): CallToolResult {
  const args = chunkTextInputSchema.parse(rawArgs);
  const { text, maxTokens, overlap, strategy } = args;
  const chunks = chunkMarkdown(text, { maxTokens, overlap, strategy });
  const content = renderChunkIndex(chunks);
  return {
    content: [{ text: content, type: 'text' }],
    structuredContent: {
      schemaVersion: 1,
      content,
      chunks,
    },
  };
}

export const CHUNK_TEXT_TOOL_DESCRIPTION = `Split already-extracted text into token-bounded chunks for embedding/RAG. Each chunk carries its index, tokenCount (chars/4), and the nearest preceding markdown heading as headingContext. Operates on any text — pair with the \`chunk\` option on \`extract\` when you want chunks inline with the extraction. The server fetches nothing: \`text\` is the only input.`;

export function chunkTextHandler(args: unknown): CallToolResult {
  try {
    return chunkTextDocument(args);
  } catch (err) {
    logger.error(
      `chunk_text failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return toErrorResult(err);
  }
}

export function registerChunkTextTool(server: McpServer): ToolHandle {
  return server.registerTool(
    'chunk_text',
    {
      title: 'Chunk text for RAG/embedding',
      description: CHUNK_TEXT_TOOL_DESCRIPTION,
      inputSchema: chunkTextInputShape,
      outputSchema: chunkTextOutputShape,
    },
    chunkTextHandler,
  );
}
