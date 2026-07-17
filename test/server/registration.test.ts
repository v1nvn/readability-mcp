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
  it('registerTools advertises the four tools over tools/list', async () => {
    const server = createMcpServer();
    registerTools(server);
    const { client, close } = await connect(server);
    expect(await listTools(client)).toEqual([
      'extract',
      'extract_metadata',
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
    registerTools(server);
    expect(await listTools(client)).toEqual([
      'extract',
      'extract_metadata',
      'html_to_markdown',
      'outline',
    ]);
    await close();
  });

  it('createServer registers all four', async () => {
    const { client, close } = await connect(createServer());
    expect(await listTools(client)).toEqual([
      'extract',
      'extract_metadata',
      'html_to_markdown',
      'outline',
    ]);
    await close();
  });
});
