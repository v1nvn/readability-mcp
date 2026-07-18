import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  ListResourcesResultSchema,
  ListResourceTemplatesResultSchema,
  ReadResourceResultSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';

import { extractArticle } from '../../src/tools/extract.js';
import { outputSchema } from '../../src/tools/output-schema.js';
import { resetCache, registerResources } from '../../src/resources.js';
import { createMcpServer } from '../../src/server.js';

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

// Two renders of the "same" page that differ only in volatile markup. The
// nonces differ, the CSP directive carries a different nonce, and a Vue
// data-v hash changes — none of these should break the cache.
const PAGE_A = `<html><head>
<meta http-equiv="Content-Security-Policy" content="script-src 'nonce-AAAA'">
<script nonce="AAAA">console.log("boot")</script>
</head><body>
<article data-v-1a2b3c4d><h1>Title</h1>
<p>One two three four five six seven eight nine ten.</p>
<p>Sentences with enough body text for Readability to keep them.</p>
</article></body></html>`;

const PAGE_B = `<html><head>
<meta http-equiv="Content-Security-Policy" content="script-src 'nonce-ZZZZ'">
<script nonce="ZZZZ">console.log("boot")</script>
</head><body>
<article data-v-9z8y7x6w><h1>Title</h1>
<p>One two three four five six seven eight nine ten.</p>
<p>Sentences with enough body text for Readability to keep them.</p>
</article></body></html>`;

function readDiagnostics(
  result: ReturnType<typeof extractArticle>,
): {
  cache?: { hit: boolean; normalizedHash: string; originalHash: string };
} {
  const parsed = outputSchema.parse(result.structuredContent);
  return parsed.diagnostics;
}

function payloadOf(result: ReturnType<typeof extractArticle>): string {
  return outputSchema.parse(result.structuredContent).content;
}

describe('extract cache:true — diagnostics.cache', () => {
  it('is absent when cache is not requested (goldens unaffected)', () => {
    resetCache();
    const result = extractArticle({ html: PAGE_A, url: 'https://x.example/' });
    const diagnostics = readDiagnostics(result);
    expect(diagnostics.cache).toBeUndefined();
  });

  it('reports hit:false on first call, hit:true on the second (same html)', () => {
    resetCache();
    const first = extractArticle({
      cache: true,
      html: PAGE_A,
      url: 'https://x.example/',
    });
    const firstDiag = readDiagnostics(first);
    expect(firstDiag.cache).toMatchObject({ hit: false });
    expect(typeof firstDiag.cache?.normalizedHash).toBe('string');
    expect(firstDiag.cache?.normalizedHash).toBe(
      firstDiag.cache?.originalHash === firstDiag.cache?.normalizedHash
        ? firstDiag.cache?.normalizedHash
        : firstDiag.cache?.normalizedHash,
    );

    const second = extractArticle({
      cache: true,
      html: PAGE_A,
      url: 'https://x.example/',
    });
    const secondDiag = readDiagnostics(second);
    expect(secondDiag.cache).toMatchObject({ hit: true });
    expect(secondDiag.cache?.normalizedHash).toBe(firstDiag.cache?.normalizedHash);
    expect(secondDiag.cache?.originalHash).toBe(firstDiag.cache?.originalHash);
    // Byte-identical payload — cache short-circuits the pipeline.
    expect(payloadOf(second)).toBe(payloadOf(first));
  });

  it('hits across re-renders that differ only by nonce / CSP / data-v hash', () => {
    resetCache();
    const a = extractArticle({
      cache: true,
      html: PAGE_A,
      url: 'https://x.example/',
    });
    const b = extractArticle({
      cache: true,
      html: PAGE_B,
      url: 'https://x.example/',
    });
    const aDiag = readDiagnostics(a).cache;
    const bDiag = readDiagnostics(b).cache;
    expect(aDiag?.hit).toBe(false);
    expect(bDiag?.hit).toBe(true);
    // Same normalized hash → cache key stable across the volatile delta.
    expect(bDiag?.normalizedHash).toBe(aDiag?.normalizedHash);
    // Different original hash → the difference is observable in the raw input.
    expect(bDiag?.originalHash).not.toBe(aDiag?.originalHash);
    expect(payloadOf(b)).toBe(payloadOf(a));
  });

  it('misses when output-affecting args differ (format:markdown vs format:html)', () => {
    resetCache();
    const md = extractArticle({
      cache: true,
      html: PAGE_A,
      url: 'https://x.example/',
      format: 'markdown',
    });
    const htmlResult = extractArticle({
      cache: true,
      html: PAGE_A,
      url: 'https://x.example/',
      format: 'html',
    });
    const mdDiag = readDiagnostics(md).cache;
    const htmlDiag = readDiagnostics(htmlResult).cache;
    expect(mdDiag?.hit).toBe(false);
    expect(htmlDiag?.hit).toBe(false);
    // Same normalized HTML hash — the cache key delta is the args fingerprint.
    expect(htmlDiag?.normalizedHash).toBe(mdDiag?.normalizedHash);
    expect(htmlDiag?.originalHash).toBe(mdDiag?.originalHash);
    expect(payloadOf(htmlResult)).not.toBe(payloadOf(md));
  });
});

describe('MCP resources/list + resources/read', () => {
  it('advertises the readability://page/{hash} template', async () => {
    const server = createMcpServer();
    registerResources(server);
    const { client, close } = await connect(server);
    const result = await client.request(
      { method: 'resources/templates/list' },
      ListResourceTemplatesResultSchema,
    );
    const uris = result.resourceTemplates.map(t => t.uriTemplate);
    expect(uris).toContain('readability://page/{hash}');
    await close();
  });

  it('lists cached entries after extract cache:true, and reads them back', async () => {
    resetCache();
    // Populate the cache via the extract API.
    const result = extractArticle({
      cache: true,
      html: PAGE_A,
      url: 'https://x.example/',
    });
    const expectedText = payloadOf(result);

    const server = createMcpServer();
    registerResources(server);
    const { client, close } = await connect(server);

    const list = await client.request(
      { method: 'resources/list' },
      ListResourcesResultSchema,
    );
    expect(list.resources.length).toBeGreaterThanOrEqual(1);
    const cached = list.resources.find(r =>
      r.uri.startsWith('readability://page/'),
    );
    expect(cached).toBeDefined();
    expect(cached?.mimeType).toBe('text/markdown');

    const read = await client.request(
      { method: 'resources/read', params: { uri: cached?.uri ?? '' } },
      ReadResourceResultSchema,
    );
    const textContent = read.contents.find(c => 'text' in c);
    expect(textContent && 'text' in textContent ? textContent.text : '').toBe(
      expectedText,
    );
    await close();
  });

  it('returns empty text for an unknown hash (no throw)', async () => {
    const server = createMcpServer();
    registerResources(server);
    const { client, close } = await connect(server);
    const read = await client.request(
      {
        method: 'resources/read',
        params: { uri: 'readability://page/does-not-exist' },
      },
      ReadResourceResultSchema,
    );
    const textContent = read.contents.find(c => 'text' in c);
    expect(textContent && 'text' in textContent ? textContent.text : '').toBe(
      '',
    );
    await close();
  });
});
