import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createHttpRequestListener } from '../src/http-transport.js';

function mintHeader(secret: string, unixSeconds: number): string {
  const message = `t=${unixSeconds}`;
  const hex = createHmac('sha256', secret).update(message).digest('hex');
  return `${message},v1=${hex}`;
}

async function withServer(run: (base: string) => Promise<void>): Promise<void> {
  const server = createServer((req, res) => {
    void createHttpRequestListener()(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

describe('HTTP transport', () => {
  const original = process.env.CONDUIT_S2S_SECRET;

  afterEach(() => {
    if (original === undefined) delete process.env.CONDUIT_S2S_SECRET;
    else process.env.CONDUIT_S2S_SECRET = original;
  });

  it('serves /health without credentials and 404s unknown paths', async () => {
    delete process.env.CONDUIT_S2S_SECRET;
    await withServer(async (base) => {
      const health = await fetch(`${base}/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ status: 'ok', server: 'webfleet-mcp' });

      const missing = await fetch(`${base}/other`);
      expect(missing.status).toBe(404);
    });
  });

  it('requires a valid X-Gateway-S2S header when the secret is set', async () => {
    const secret = 'webfleet-s2s-test-secret';
    process.env.CONDUIT_S2S_SECRET = secret;
    await withServer(async (base) => {
      const denied = await fetch(`${base}/mcp`, { method: 'POST' });
      expect(denied.status).toBe(401);

      const now = Math.floor(Date.now() / 1000);
      const allowed = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-gateway-s2s': mintHeader(secret, now),
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '0' } } }),
      });
      expect(allowed.status).not.toBe(401);
    });
  });
});
