import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { loadConfig } from './config.js';
import { registerPrompts } from './prompts.js';
import { registerResources } from './resources.js';
import { registerChunkTextTool } from './tools/chunk_text.js';
import { registerExplainTool } from './tools/explain.js';
import { registerExtractLinksTool } from './tools/extract_links.js';
import { registerExtractMetadataTool } from './tools/extract_metadata.js';
import { registerExtractSectionTool } from './tools/extract_section.js';
import { registerExtractTablesTool } from './tools/extract_tables.js';
import { registerExtractTool } from './tools/extract.js';
import { registerHtmlToMarkdownTool } from './tools/html_to_markdown.js';
import { registerOutlineTool } from './tools/outline.js';

// Re-exported so the dev hot-reload loop can import server.ts as a single
// RuntimeModule and pick up every registration family (tools/prompts/resources).
export { registerPrompts };
export { registerResources };

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
    registerExplainTool(server),
    registerExtractLinksTool(server),
    registerExtractTool(server),
    registerExtractMetadataTool(server),
    registerExtractSectionTool(server),
    registerExtractTablesTool(server),
    registerHtmlToMarkdownTool(server),
    registerOutlineTool(server),
  ];
}

export function createServer(): McpServer {
  const server = createMcpServer();
  registerTools(server);
  registerPrompts(server);
  registerResources(server);
  return server;
}
