import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  GetPromptResultSchema,
  ListPromptsResultSchema,
  ListResourceTemplatesResultSchema,
  ListToolsResultSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';

import {
  createMcpServer,
  createServer,
  registerTools,
} from '../../src/server.js';

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

async function listPrompts(client: Client): Promise<string[]> {
  const result = await client.request(
    { method: 'prompts/list' },
    ListPromptsResultSchema,
  );
  return result.prompts.map(prompt => prompt.name).sort();
}

async function listResourceTemplateUris(client: Client): Promise<string[]> {
  const result = await client.request(
    { method: 'resources/templates/list' },
    ListResourceTemplatesResultSchema,
  );
  return result.resourceTemplates.map(t => t.uriTemplate).sort();
}

async function getPromptText(
  client: Client,
  name: string,
  args: Record<string, string>,
): Promise<string> {
  const result = await client.request(
    { method: 'prompts/get', params: { name, arguments: args } },
    GetPromptResultSchema,
  );
  const message = result.messages[0];
  if (message.content.type !== 'text') {
    throw new Error(`expected text content, got ${message.content.type}`);
  }
  return message.content.text;
}

describe('tool registration', () => {
  it('registerTools advertises the ten tools over tools/list', async () => {
    const server = createMcpServer();
    registerTools(server);
    const { client, close } = await connect(server);
    expect(await listTools(client)).toEqual([
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
    ]);
    await close();
  });

  it('createServer registers all ten', async () => {
    const { client, close } = await connect(createServer());
    expect(await listTools(client)).toEqual([
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
    ]);
    await close();
  });
});

describe('prompt registration', () => {
  it('createServer advertises read_url over prompts/list', async () => {
    const { client, close } = await connect(createServer());
    expect(await listPrompts(client)).toEqual(['read_url']);
    await close();
  });

  it('prompts/get read_url fills the url and references extract', async () => {
    const { client, close } = await connect(createServer());
    const text = await getPromptText(client, 'read_url', {
      url: 'https://example.com',
    });
    expect(text).toContain('https://example.com');
    expect(text).toContain('extract');
    await close();
  });
});

describe('resource registration', () => {
  it('createServer advertises the readability://page/{hash} template', async () => {
    const { client, close } = await connect(createServer());
    expect(await listResourceTemplateUris(client)).toEqual([
      'readability://page/{hash}',
    ]);
    await close();
  });
});
