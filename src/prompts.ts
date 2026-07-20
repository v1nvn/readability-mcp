import { z } from 'zod';

import type { ToolHandle } from './server.js';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export const READ_URL_PROMPT_DESCRIPTION =
  'Choreograph the canonical two-tool flow for reading a live URL: a browser tool (chrome-devtools) renders the page and captures document.documentElement.outerHTML, then the readability `extract` tool turns that HTML into Markdown. Returns a filled user message telling the host exactly how to execute the flow for the given url.';

function recipe(url: string): string {
  return `Extract the main article content from: ${url}

The readability server never fetches URLs and reads HTML only from a file path (so the page bytes never enter the model context), so a browser tool must render the page and write its DOM to disk, then point readability at that file. Execute these steps in order.

1. Render the page with a browser tool (chrome-devtools).
   - Navigate to ${url}.
   - Wait for the page to finish rendering (network idle / load).
   - Scroll through the page to trigger any lazy-loaded content.

2. Capture the rendered DOM to a file.
   - Run the browser's JavaScript evaluation (chrome-devtools \`evaluate_script\`) with its \`filePath\` argument set to an absolute path, evaluating:
       document.documentElement.outerHTML
   - \`evaluate_script\` writes the returned string to that path; emit only the path from here on, never the HTML itself.

3. Extract the article.
   - Call the readability \`extract\` tool with arguments:
       { localPath: <the absolute path from step 2>, baseUrl: "${url}" }
   - \`baseUrl\` is origin context only: it absolutizes relative links and is never fetched by the readability server.`;
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
            'Absolute URL of the page to render and extract. Passed to extract as `baseUrl` (absolutizes relative links); the readability server never fetches it.',
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
