import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { loadConfig } from './config.js';
import { registerExtractTool } from './tools/extract.js';
import { registerHtmlToMarkdownTool } from './tools/html_to_markdown.js';
import { registerOutlineTool } from './tools/outline.js';

// `remove()` unregisters the tool and notifies the client; dev reload holds the
// previous batch to remove before re-registering.
export interface ToolHandle {
  remove(): void;
}

export function createMcpServer(): McpServer {
  const { name, version, title, description, instructions } = loadConfig();
  return new McpServer({ name, version, title, description }, { instructions });
}

export function registerTools(server: McpServer): ToolHandle[] {
  return [
    registerExtractTool(server),
    registerHtmlToMarkdownTool(server),
    registerOutlineTool(server),
  ];
}

export function createServer(): McpServer {
  const server = createMcpServer();
  registerTools(server);
  return server;
}
