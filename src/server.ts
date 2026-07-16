import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { loadConfig } from './config.js';
import { registerExtractTool } from './tools/extract.js';
import { registerHtmlToMarkdownTool } from './tools/html_to_markdown.js';
import { registerOutlineTool } from './tools/outline.js';

// A live tool handle. The SDK returns one per `registerTool`; `remove()`
// unregisters it and notifies the client (`tools/list_changed`). Hot reload
// holds the previous batch and removes it before registering a fresh batch.
export interface ToolHandle {
  remove(): void;
}

export function createMcpServer(): McpServer {
  const { name, version } = loadConfig();
  return new McpServer({ name, version });
}

// `extract` and `html_to_markdown` share one Turndown + DOMPurify pipeline
// (extract runs Readability first, html_to_markdown converts a fragment without
// scoring); `outline` skips that pipeline entirely — it is a heading-only walk
// over the normalized DOM. Returns the handles so callers can manage lifecycle
// (prod drops them; dev reload removes the previous batch on each reload).
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
