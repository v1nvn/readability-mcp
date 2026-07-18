import { z } from 'zod';

import type { ToolHandle } from './server.js';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export const READ_URL_PROMPT_DESCRIPTION =
  'Choreograph the canonical two-tool flow for reading a live URL: a browser tool (chrome-devtools) renders the page and captures document.documentElement.outerHTML, then the readability `extract` tool turns that HTML into Markdown. Returns a filled user message telling the host exactly how to execute the flow for the given url.';

function recipe(url: string): string {
  return `Extract the main article content from: ${url}

The readability server never fetches URLs, so a browser tool must render the page first, then hand the rendered HTML to readability. Execute these steps in order.

1. Render the page with a browser tool (chrome-devtools).
   - Navigate to ${url}.
   - Wait for the page to finish rendering (network idle / load).
   - Scroll through the page to trigger any lazy-loaded content.

2. Capture the rendered DOM.
   - Run the browser's JavaScript evaluation (chrome-devtools \`evaluate_script\`) and return:
       document.documentElement.outerHTML

3. Extract the article.
   - Call the readability \`extract\` tool with arguments:
       { html: <the outerHTML from step 2>, url: "${url}" }
   - The \`url\` is origin context only: it absolutizes relative links and is never fetched by the readability server.`;
}

export function registerReadUrlPrompt(server: McpServer): ToolHandle {
  return server.registerPrompt(
    'read_url',
    {
      title: 'Read a live URL to Markdown',
      description: READ_URL_PROMPT_DESCRIPTION,
      argsSchema: {
        url: z
          .string()
          .describe(
            'Absolute URL of the page to render and extract. Passed to extract as origin context (absolutizes relative links); the readability server never fetches it.',
          ),
      },
    },
    ({ url }) => ({
      messages: [
        {
          role: 'user' as const,
          content: { type: 'text' as const, text: recipe(url) },
        },
      ],
    }),
  );
}

export function registerPrompts(server: McpServer): ToolHandle[] {
  return [registerReadUrlPrompt(server)];
}
