// Contract test for the tool-registration split that hot reload depends on.
//
// Reload swaps tools on a single long-lived McpServer by `.remove()`-ing the
// previous handles and re-registering a fresh batch. These tests lock the
// observable contract over the real protocol (a Client driving `tools/list`
// through a linked in-memory transport), not private SDK state: the server
// advertises exactly the registered tools, removal hides them, and
// re-registration after removal is clean — the exact sequence `src/dev.ts`
// runs on each file change.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';

import { createMcpServer, createServer, registerTools } from '../../src/server.js';

interface LoopbackTransport {
  onmessage?: (message: unknown) => void;
  onclose?: () => void;
  onerror?: (error: unknown) => void;
  start(): Promise<void>;
  send(message: unknown): Promise<void>;
  close(): Promise<void>;
}

// Back-to-back transport pair: each side's send() delivers to the other's
// onmessage. Mirrors the SDK's InMemoryTransport without depending on its
// (non-exported) subpath.
function linkedTransports(): [LoopbackTransport, LoopbackTransport] {
  let a: LoopbackTransport;
  let b: LoopbackTransport;
  a = {
    close: async () => {},
    send: async message => {
      b.onmessage?.(message);
    },
    start: async () => {},
  };
  b = {
    close: async () => {},
    send: async message => {
      a.onmessage?.(message);
    },
    start: async () => {},
  };
  return [a, b];
}

// Connect a server to a fresh Client over a loopback pair. Registration happens
// after connecting — the SDK's handlers read live registrations, so order is
// irrelevant.
async function connect(server: ReturnType<typeof createMcpServer>): Promise<{
  client: Client;
  close: () => Promise<void>;
}> {
  const [serverT, clientT] = linkedTransports();
  await server.connect(serverT);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientT);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

async function listTools(client: Client): Promise<string[]> {
  const result = await client.request(
    { method: 'tools/list' },
    ListToolsResultSchema,
  );
  return result.tools.map(tool => tool.name).sort();
}

describe('tool registration', () => {
  it('registerTools advertises the three tools over tools/list', async () => {
    const server = createMcpServer();
    registerTools(server);
    const { client, close } = await connect(server);
    expect(await listTools(client)).toEqual([
      'extract',
      'html_to_markdown',
      'outline',
    ]);
    await close();
  });

  it('removing every handle hides the tools', async () => {
    const server = createMcpServer();
    const handles = registerTools(server);
    const { client, close } = await connect(server);
    for (const handle of handles) {
      handle.remove();
    }
    expect(await listTools(client)).toEqual([]);
    await close();
  });

  it('re-registers cleanly after removal (the reload contract)', async () => {
    const server = createMcpServer();
    const handles = registerTools(server);
    const { client, close } = await connect(server);
    for (const handle of handles) {
      handle.remove();
    }
    // The capability/handler init from the first registration is idempotent, so
    // re-registering on the connected server is exactly what dev reload does.
    registerTools(server);
    expect(await listTools(client)).toEqual([
      'extract',
      'html_to_markdown',
      'outline',
    ]);
    await close();
  });

  it('createServer registers all three', async () => {
    const { client, close } = await connect(createServer());
    expect(await listTools(client)).toEqual([
      'extract',
      'html_to_markdown',
      'outline',
    ]);
    await close();
  });
});
