import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { loadConfig } from './config.js';
import { registerPrompts } from './prompts.js';
import { registerResources } from './resources.js';
import { registerSamplingTools } from './sampling.js';
import { registerChunkTextTool } from './tools/chunk_text.js';
import { registerExplainTool } from './tools/explain.js';
import { registerExtractLinksTool } from './tools/extract_links.js';
import { registerExtractListTool } from './tools/extract_list.js';
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

// A tool earns its place only by skipping a pipeline stage (outline,
// extract_metadata skip Readability) or returning a fundamentally different
// shape (extract_list is a second engine). Alternate views of the one pipeline
// — tables, images, structured data, code — are options or fields on `extract`,
// not separate tools; that keeps the MCP surface small and the pipeline deep.
export function registerTools(server: McpServer): ToolHandle[] {
  return [
    registerChunkTextTool(server),
    registerExplainTool(server),
    registerExtractLinksTool(server),
    registerExtractListTool(server),
    registerExtractTool(server),
    registerExtractMetadataTool(server),
    registerExtractSectionTool(server),
    registerExtractTablesTool(server),
    registerHtmlToMarkdownTool(server),
    registerOutlineTool(server),
  ];
}

// Capability-gated tools are registered AFTER the initialize handshake, not
// eagerly with the families above. The MCP `tools` capability locks in on the
// first pre-connect registration (registerCapabilities throws post-connect),
// so the tool-list handlers are already live; adding to `_registeredTools`
// later simply appears in the next `tools/list` and fires `listChanged`. The
// low-level Server populates `getClientCapabilities()` from the client's
// `initialize` request, exposed via `McpServer.server`.
export function registerCapabilityGatedTools(server: McpServer): ToolHandle[] {
  const caps = server.server.getClientCapabilities();
  if (!caps?.sampling) {
    return [];
  }
  return registerSamplingTools(server);
}

export function createServer(): McpServer {
  const server = createMcpServer();
  registerTools(server);
  registerPrompts(server);
  registerResources(server);
  // Capability-gated tools (sampling) need the client's advertised
  // capabilities, which the low-level Server only populates after the
  // initialize handshake. Hook the `initialized` notification — it fires once
  // the client has connected and before any `tools/list`. `dev.ts` re-runs the
  // gate directly on reload (the client is already past `initialized`).
  server.server.oninitialized = () => {
    registerCapabilityGatedTools(server);
  };
  return server;
}
