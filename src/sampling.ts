// Optional, capability-gated features backed by the HOST's model via MCP
// `sampling/createMessage` (server→client request). The server never embeds a
// model and never calls a provider directly — every LLM call is delegated to
// the connected client, which picks the model and may prompt the user first.

import { z } from 'zod';

import type { ToolHandle } from './server.js';

import { toErrorResult } from './errors.js';
import { logger } from './logger.js';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const SUMMARIZE_SYSTEM_PROMPT =
  'Summarize the user-supplied text concisely while preserving its key points, entities, and any decisive conclusions. Output only the summary prose — no preamble, no headings unless the source had them.';

const summarizeInputShape = {
  text: z
    .string()
    .describe(
      'The markdown or text to summarize — typically the output of `extract`, `extract_section`, `html_to_markdown`, or `chunk_text`. Passed through to the host model verbatim; the server does not parse or modify it.',
    ),
  maxTokens: z
    .number()
    .int()
    .min(1)
    .describe(
      'Upper bound on the summary length in tokens, forwarded to the host as `sampling/createMessage` maxTokens. The host chooses the actual length.',
    )
    .default(512),
} as const;

const summarizeInputSchema = z.object(summarizeInputShape);

export const SUMMARIZE_TOOL_DESCRIPTION = `Summarize text using the HOST's model via MCP \`sampling/createMessage\` — the server embeds no model and calls no provider directly. Hand it the output of \`extract\`, \`extract_section\`, \`html_to_markdown\`, or any markdown/text string; the host picks the model and may ask the user to approve the sampling request (human-in-the-loop per MCP). The tool is only listed when the connected client advertises the sampling capability.`;

async function summarizeWithHost(
  server: McpServer,
  args: { maxTokens: number; text: string },
): Promise<string> {
  const result = await server.server.createMessage({
    messages: [
      {
        role: 'user',
        content: { type: 'text', text: args.text },
      },
    ],
    systemPrompt: SUMMARIZE_SYSTEM_PROMPT,
    maxTokens: args.maxTokens,
  });
  if (result.content.type !== 'text') {
    throw new Error(
      `host sampling returned non-text content (${result.content.type}); summarize expects a text response`,
    );
  }
  return result.content.text;
}

export function registerSummarizeTool(server: McpServer): ToolHandle {
  return server.registerTool(
    'summarize',
    {
      title: 'Summarize text using the host model',
      description: SUMMARIZE_TOOL_DESCRIPTION,
      inputSchema: summarizeInputShape,
    },
    async (rawArgs: unknown): Promise<CallToolResult> => {
      const args = summarizeInputSchema.parse(rawArgs);
      try {
        const summary = await summarizeWithHost(server, args);
        return {
          content: [{ type: 'text', text: summary }],
        };
      } catch (err) {
        logger.error(
          `summarize failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return toErrorResult(err);
      }
    },
  );
}

// Mirrors registerTools/registerPrompts/registerResources so the dev reload
// loop and capability gate can treat sampling as one registration family.
export function registerSamplingTools(server: McpServer): ToolHandle[] {
  return [registerSummarizeTool(server)];
}
