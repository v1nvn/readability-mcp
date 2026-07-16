// Dev-only entry: in-process hot reload of tool implementations without
// restarting the process or dropping the MCP client connection.
//
// The stdio transport and the McpServer are single-use under the MCP SDK
// (`StdioServerTransport.start()` throws on a second call; `Protocol.connect()`
// calls it), so they are created exactly once and live for the whole process.
// Only the tool registrations are reloadable: on each file change we re-import
// `server.ts` through Vite's SSR module runner, `.remove()` the previous tool
// handles, and register a fresh batch — the SDK notifies the client via
// `tools/list_changed`.
//
// This file is never bundled into `dist` (`vite build` entry is `src/index.ts`).
// MCP owns stdout, so every diagnostic goes to stderr via the logger.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createServerModuleRunner,
  createServer as createViteServer,
} from 'vite';

import { logger } from './logger.js';

// The reloadable module is loaded through Vite, not imported statically, so the
// runner controls its cache and can re-evaluate it on change. Its shape mirrors
// what `src/server.ts` exports; the runtime instance comes from `runner.import`.
interface RuntimeModule {
  createMcpServer(): McpServer;
  registerTools(server: McpServer): { remove(): void }[];
}

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const serverEntry = resolve(here, 'server.ts');

// Editors save several files in quick succession; coalesce the burst into one
// reload rather than reloading per file.
const RELOAD_DEBOUNCE_MS = 150;

const ignoredSegments = ['/node_modules/', '/dist/', '/.git/', '/coverage/'];

function shouldReload(file: string): boolean {
  return ignoredSegments.every(seg => !file.includes(seg));
}

async function main(): Promise<void> {
  // Programmatic Vite dev server: transform + module graph + watcher, no HTTP
  // listener and no stdout output. `configFile: false` keeps it decoupled from
  // the build/vitest config; the SSR environment is runnable by default.
  const vite = await createViteServer({
    appType: 'custom',
    configFile: false,
    // Vite logs `info` (e.g. "(ssr) page reload") via `console.log` to stdout,
    // which would corrupt the MCP stream. `warn` keeps transform errors on
    // stderr and silences the info-level reload chatter.
    logLevel: 'warn',
    root,
    server: { middlewareMode: true },
  });

  // HMR off: reloads are driven deterministically from the watcher below, so the
  // runner's HMR client would only duplicate the work.
  const runner = createServerModuleRunner(vite.environments.ssr, {
    hmr: false,
  });

  const first = await runner.import<RuntimeModule>(serverEntry);

  // The SDK registers the `tools` capability on the first registration, which
  // must precede connect (`Server.registerCapabilities` throws post-connect).
  // Reloads only re-add tools — the capability/handler init is idempotent, so
  // later registerTool calls on the connected server are safe.
  const server = first.createMcpServer();
  let handles = first.registerTools(server);

  // One server, one transport, connected exactly once — never reconnected.
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Reloads are serialized through a promise chain: each debounced change
  // appends one reload after any in-flight reload, so concurrent saves never
  // overlap and a save arriving mid-reload still produces a follow-up.
  let reloadChain: Promise<void> = Promise.resolve();

  function scheduleReload(): void {
    reloadChain = reloadChain.then(runOneReload);
  }

  async function runOneReload(): Promise<void> {
    try {
      runner.evaluatedModules.clear();
      const next = await runner.import<RuntimeModule>(serverEntry);
      // Import succeeded before we touch the live registrations, so a failed
      // reload (transform/syntax error thrown above) leaves the currently
      // serving tools intact.
      for (const handle of handles) {
        handle.remove();
      }
      handles = next.registerTools(server);
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
      // Best-effort close during shutdown; the rejection is intentionally swallowed.
    }
    try {
      await vite.close();
    } catch {
      // Best-effort close during shutdown; the rejection is intentionally swallowed.
    }
    // Closing the server and Vite does not guarantee the event loop drains, so
    // force-exit on signal. The n/no-process-exit rule targets libraries.
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
