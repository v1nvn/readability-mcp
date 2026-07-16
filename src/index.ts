// Bin entry: build the server, bind it to stdio, and run until signalled.
// Vite bundles this file (see vite.config.ts `ssr`). MCP owns stdout, so this
// entry never writes to it — all diagnostics go through the stderr logger.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createServer } from './server.js';

const server: McpServer = createServer();
const transport = new StdioServerTransport();

await server.connect(transport);

// Disconnect the transport before exiting so the client sees a clean close
// rather than a broken pipe. swallow close errors — we're exiting regardless.
function shutdown(): void {
  void server
    .close()
    .catch(() => {
      // Best-effort close during shutdown; the rejection is intentionally swallowed.
    })
    .finally(() => {
      // Bin entry: closing the transport does not guarantee the event loop drains,
      // so force-exit on signal. The n/no-process-exit rule targets libraries.
      // eslint-disable-next-line n/no-process-exit
      process.exit(0);
    });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
