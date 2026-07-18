// Dev-only hot reload: tool implementations reload on file change without
// restarting the process. The transport and McpServer are single-use under the
// SDK (`StdioServerTransport.start()` throws on a second call), so they live for
// the whole process and only the tool registrations are swapped. Never bundled
// into dist (build entry is src/index.ts). Diagnostics go to stderr.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createServerModuleRunner,
  createServer as createViteServer,
} from 'vite';

import { logger } from './logger.js';

// Loaded through Vite (not imported statically) so the runner controls its cache
// and can re-evaluate it on change.
interface RuntimeModule {
  createMcpServer(): McpServer;
  registerPrompts(server: McpServer): { remove(): void }[];
  registerTools(server: McpServer): { remove(): void }[];
}

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const serverEntry = resolve(here, 'server.ts');

const RELOAD_DEBOUNCE_MS = 150;

const ignoredSegments = ['/node_modules/', '/dist/', '/.git/', '/coverage/'];

function shouldReload(file: string): boolean {
  return ignoredSegments.every(seg => !file.includes(seg));
}

async function main(): Promise<void> {
  const vite = await createViteServer({
    appType: 'custom',
    configFile: false,
    // Vite logs `info` (e.g. "(ssr) page reload") via console.log to stdout,
    // which corrupts the MCP stream; `warn` keeps errors on stderr.
    logLevel: 'warn',
    root,
    server: { middlewareMode: true },
  });

  // HMR off — reloads are driven from the watcher below.
  const runner = createServerModuleRunner(vite.environments.ssr, {
    hmr: false,
  });

  const first = await runner.import<RuntimeModule>(serverEntry);

  // The `tools` capability registers on the first registration and must precede
  // connect (registerCapabilities throws post-connect); reloads are idempotent.
  const server = first.createMcpServer();
  let handles = first.registerTools(server);
  let promptHandles = first.registerPrompts(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Serialized via a promise chain: concurrent saves never overlap, and a
  // mid-reload save still produces a follow-up.
  let reloadChain: Promise<void> = Promise.resolve();

  function scheduleReload(): void {
    reloadChain = reloadChain.then(runOneReload);
  }

  async function runOneReload(): Promise<void> {
    try {
      runner.evaluatedModules.clear();
      const next = await runner.import<RuntimeModule>(serverEntry);
      // Import before removing live registrations so a failed reload leaves the
      // currently-serving tools intact.
      for (const handle of handles) {
        handle.remove();
      }
      for (const handle of promptHandles) {
        handle.remove();
      }
      handles = next.registerTools(server);
      promptHandles = next.registerPrompts(server);
      logger.info('[reload] success');
    } catch (err) {
      logger.error(
        `[reload] failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  let timer: NodeJS.Timeout | undefined;
  vite.watcher.on('change', file => {
    if (!shouldReload(file)) {
      return;
    }
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      scheduleReload();
    }, RELOAD_DEBOUNCE_MS);
  });

  logger.info('[reload] ready');

  async function shutdown(): Promise<void> {
    try {
      await server.close();
    } catch {
      // best-effort during shutdown
    }
    try {
      await vite.close();
    } catch {
      // best-effort during shutdown
    }
    // Force-exit on signal; the n/no-process-exit rule targets libraries.
    // eslint-disable-next-line n/no-process-exit
    process.exit(0);
  }
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((error: unknown) => {
  logger.error(
    `dev failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  // eslint-disable-next-line n/no-process-exit
  process.exit(1);
});
