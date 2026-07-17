import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { loadConfig } from './config.js';
import { registerChunkTextTool } from './tools/chunk_text.js';
import { registerExtractLinksTool } from './tools/extract_links.js';
import { registerExtractMetadataTool } from './tools/extract_metadata.js';
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
    registerChunkTextTool(server),
    registerExtractLinksTool(server),
    registerExtractTool(server),
    registerExtractMetadataTool(server),
    registerHtmlToMarkdownTool(server),
    registerOutlineTool(server),
  ];
}

export function createServer(): McpServer {
  const server = createMcpServer();
  registerTools(server);
  return server;
}
