import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { loadConfig } from './config.js';
import { registerExtractTool } from './tools/extract.js';
import { registerHtmlToMarkdownTool } from './tools/html_to_markdown.js';

// Factory for the high-level MCP server. Both tools share one Turndown +
// DOMPurify pipeline; `extract` runs Readability first, `html_to_markdown`
// converts a fragment without scoring.
export function createServer(): McpServer {
  const { name, version } = loadConfig();
  const server = new McpServer({ name, version });
  registerExtractTool(server);
  registerHtmlToMarkdownTool(server);
  return server;
}
