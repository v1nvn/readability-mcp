import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  CallToolResultSchema,
  CreateMessageRequestSchema,
  ListToolsResultSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';

import { createServer } from '../../src/server.js';

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

// Mirrors registration.test.ts but the client is constructed ADVERTISING the
// sampling capability. createServer wires the `initialized` hook itself, so the
// gate fires after the initialize handshake and lists the summarize tool.
async function connect(opts?: {
  sampling?: boolean;
}): Promise<{ client: Client; close: () => Promise<void> }> {
  const server = createServer();
  const [serverT, clientT] = linkedTransports();
  await server.connect(serverT);
  const client = new Client(
    { name: 'test-client', version: '0.0.0' },
    { capabilities: opts?.sampling ? { sampling: {} } : {} },
  );
  await client.connect(clientT);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

async function listToolNames(client: Client): Promise<string[]> {
  const result = await client.request(
    { method: 'tools/list' },
    ListToolsResultSchema,
  );
  return result.tools.map(tool => tool.name).sort();
}

describe('summarize tool capability gating', () => {
  it('lists summarize when the client advertises sampling', async () => {
    const { client, close } = await connect({ sampling: true });
    const names = await listToolNames(client);
    expect(names).toContain('summarize');
    // The ten always-on tools still appear alongside it.
    expect(names).toEqual(
      expect.arrayContaining([
        'chunk_text',
        'explain',
        'extract',
        'extract_links',
        'extract_list',
        'extract_metadata',
        'extract_section',
        'extract_tables',
        'html_to_markdown',
        'outline',
        'summarize',
      ]),
    );
    expect(names).toHaveLength(11);
    await close();
  });

  it('hides summarize when the client does not advertise sampling', async () => {
    const { client, close } = await connect({ sampling: false });
    const names = await listToolNames(client);
    expect(names).not.toContain('summarize');
    expect(names).toHaveLength(10);
    await close();
  });

  it('returns the host-generated summary from sampling/createMessage', async () => {
    const { client, close } = await connect({ sampling: true });

    // The client answers server→client sampling requests. The host has full
    // discretion over the model; here it returns a fixed summary so we can
    // assert the tool surfaces it verbatim.
    client.setRequestHandler(CreateMessageRequestSchema, async request => {
      expect(request.params.messages).toHaveLength(1);
      expect(request.params.systemPrompt).toBeTruthy();
      expect(typeof request.params.maxTokens).toBe('number');
      return {
        role: 'assistant',
        content: { type: 'text', text: 'A short host-written summary.' },
        model: 'host-stub',
      };
    });

    const result = await client.request(
      {
        method: 'tools/call',
        params: {
          name: 'summarize',
          arguments: {
            text: 'Long article body that the host model should summarize.',
            maxTokens: 64,
          },
        },
      },
      CallToolResultSchema,
    );
    expect(result.isError).toBeFalsy();
    expect(result.content[0]).toEqual({
      type: 'text',
      text: 'A short host-written summary.',
    });
    await close();
  });

  it('returns isError when the host sampling call fails at runtime', async () => {
    const { client, close } = await connect({ sampling: true });

    client.setRequestHandler(CreateMessageRequestSchema, async () => {
      throw new Error('host model unavailable');
    });

    const result = await client.request(
      {
        method: 'tools/call',
        params: {
          name: 'summarize',
          arguments: { text: 'anything' },
        },
      },
      CallToolResultSchema,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe('text');
    await close();
  });
});
