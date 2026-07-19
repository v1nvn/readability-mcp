import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createServer } from './server.js';

if (process.argv[2] === 'extract') {
  void import('./cli.js')
    .then(m => m.runCli(process.argv.slice(2)))
    .then(code => {
      // eslint-disable-next-line n/no-process-exit
      process.exit(code);
    })
    .catch((err: unknown) => {
      process.stderr.write(
        `${err instanceof Error ? err.message : String(err)}\n`,
      );
      // eslint-disable-next-line n/no-process-exit
      process.exit(1);
    });
} else {
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
}
