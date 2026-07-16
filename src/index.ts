import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createServer } from './server.js';

const server: McpServer = createServer();
const transport = new StdioServerTransport();

await server.connect(transport);

function shutdown(): void {
  void server
    .close()
    .catch(() => {
      // best-effort; exiting regardless
    })
    .finally(() => {
      // Force-exit on signal; the n/no-process-exit rule targets libraries.
      // eslint-disable-next-line n/no-process-exit
      process.exit(0);
    });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
