import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { loadConfig } from './config.js';
import { registerExtractTool } from './tools/extract.js';
import { registerHtmlToMarkdownTool } from './tools/html_to_markdown.js';
import { registerOutlineTool } from './tools/outline.js';

// Factory for the high-level MCP server. `extract` and `html_to_markdown`
// share one Turndown + DOMPurify pipeline (extract runs Readability first,
// html_to_markdown converts a fragment without scoring); `outline` skips that
// pipeline entirely — it is a heading-only walk over the normalized DOM.
export function createServer(): McpServer {
  const { name, version } = loadConfig();
  const server = new McpServer({ name, version });
  registerExtractTool(server);
  registerHtmlToMarkdownTool(server);
  registerOutlineTool(server);
  return server;
}
