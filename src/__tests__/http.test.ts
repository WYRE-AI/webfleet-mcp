import { createHmac } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveCredentials } from '../client.js';
import { isGatewayMode, resetGatewayLock } from '../config.js';
import { resolveHttpConfig, s2sSecretProblem, startHttpServer, StartupError, type HttpConfig } from '../http.js';
import { resetToolsets } from '../tools/index.js';
import { basicOf, CREDS, FAKE_API_KEY, FAKE_ENV_API_KEY, FAKE_ENV_PASSWORD, FAKE_PASSWORD, FAKE_S2S_SECRET, FAKE_USERNAME, jsonResponse, setEnvCredentials } from './helpers.js';

const ENV_KEYS = [
  'AUTH_MODE',
  'CONDUIT_S2S_SECRET',
  'MCP_ALLOW_INSECURE_DEV',
  'MCP_HTTP_HOST',
  'MCP_HTTP_PORT',
  'MCP_ALLOWED_HOSTS',
  'WEBFLEET_ACCOUNT',
  'WEBFLEET_USERNAME',
  'WEBFLEET_PASSWORD',
  'WEBFLEET_API_KEY',
  'WEBFLEET_TOOL_TIERS',
];
const saved = new Map(ENV_KEYS.map((k) => [k, process.env[k]]));
const servers: Server[] = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(async () => {
  vi.unstubAllGlobals();
  resetGatewayLock();
  resetToolsets();
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});
afterAll(() => {
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function mint(secret: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${createHmac('sha256', secret).update(`t=${t}`).digest('hex')}`;
}

async function listen(overrides: Partial<HttpConfig> = {}): Promise<number> {
  const config: HttpConfig = { s2sSecret: FAKE_S2S_SECRET, host: '127.0.0.1', port: 0, authMode: 'gateway', allowedHosts: null, ...overrides };
  const server = await startHttpServer(config);
  servers.push(server);
  return (server.address() as AddressInfo).port;
}

const listTools = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
const callGroups = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'webfleet_object_groups_list', arguments: {} } });

const TOOL_COUNT = 30;

const gatewayHeaders = {
  'x-webfleet-account': CREDS.account,
  'x-webfleet-username': CREDS.username,
  'x-webfleet-password': CREDS.password,
  'x-webfleet-api-key': CREDS.apiKey,
};

const envCreds = { ...CREDS, password: FAKE_ENV_PASSWORD, apiKey: FAKE_ENV_API_KEY };

function post(port: number, body: string, headers: Record<string, string> = {}, path = '/mcp') {
  return realFetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body,
  });
}

/** Loopback traffic goes to the real fetch (the server under test); Webfleet traffic is recorded and mocked. */
function stubWebfleetOnly() {
  const upstream: Array<{ action: string | null; apiKey: string | null; authorization: string | null }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.hostname === '127.0.0.1') return realFetch(input, init);
      upstream.push({ action: url.searchParams.get('action'), apiKey: url.searchParams.get('apikey'), authorization: new Headers(init?.headers).get('authorization') });
      return jsonResponse([{ objectgroupname: 'Contoso Vans', objectcount: '4' }]);
    }),
  );
  return upstream;
}

type RpcResult = { result: { tools?: Array<{ name: string }>; content?: Array<{ text: string }>; isError?: boolean } };

describe('resolveHttpConfig (startup fails closed)', () => {
  it('refuses an empty S2S secret (the container default)', () => {
    // Mirrors the Dockerfile ENV with no CONDUIT_S2S_SECRET supplied.
    expect(() =>
      resolveHttpConfig({ MCP_TRANSPORT: 'http', MCP_HTTP_PORT: '8080', MCP_HTTP_HOST: '0.0.0.0', AUTH_MODE: 'gateway', WEBFLEET_TOOL_TIERS: 'read' }),
    ).toThrow(/CONDUIT_S2S_SECRET is empty/);
  });

  it.each([
    ['changeme', /placeholder/],
    ['replace-with-a-real-secret-0123456789abcdef', /placeholder/],
    ['unknown', /shorter than 32/],
    ['short-but-random-Xy7', /shorter than 32/],
    ['a'.repeat(64), /repeated/],
    ['abcd'.repeat(10), /repeated/],
  ])('refuses weak secret %j', (secret, why) => {
    expect(s2sSecretProblem(secret)).toMatch(why);
    expect(() => resolveHttpConfig({ CONDUIT_S2S_SECRET: secret, AUTH_MODE: 'gateway' })).toThrow(StartupError);
  });

  it('accepts a strong secret and defaults to 127.0.0.1:8080', () => {
    expect(resolveHttpConfig({ CONDUIT_S2S_SECRET: FAKE_S2S_SECRET, AUTH_MODE: 'gateway' })).toMatchObject({
      host: '127.0.0.1',
      port: 8080,
      authMode: 'gateway',
      allowedHosts: null,
    });
  });

  it('insecure dev mode always binds loopback and still refuses a placeholder', () => {
    expect(resolveHttpConfig({ MCP_ALLOW_INSECURE_DEV: '1', MCP_HTTP_HOST: '0.0.0.0', AUTH_MODE: 'gateway' })).toMatchObject({ host: '127.0.0.1', s2sSecret: '' });
    expect(() => resolveHttpConfig({ MCP_ALLOW_INSECURE_DEV: '1', CONDUIT_S2S_SECRET: 'changeme' })).toThrow(StartupError);
  });

  const envVars = (c: typeof CREDS) => ({ WEBFLEET_ACCOUNT: c.account, WEBFLEET_USERNAME: c.username, WEBFLEET_PASSWORD: c.password, WEBFLEET_API_KEY: c.apiKey });

  it('env mode requires usable WEBFLEET_* credentials', () => {
    const base = { CONDUIT_S2S_SECRET: FAKE_S2S_SECRET, AUTH_MODE: 'env' };
    expect(() => resolveHttpConfig(base)).toThrow(/WEBFLEET_ACCOUNT, WEBFLEET_USERNAME, WEBFLEET_PASSWORD, WEBFLEET_API_KEY/);
    expect(() => resolveHttpConfig({ ...base, ...envVars({ ...CREDS, apiKey: 'short' }) })).toThrow(/36 characters/);
    expect(() => resolveHttpConfig({ ...base, ...envVars(CREDS) })).not.toThrow();
  });

  it('a startup error never echoes a credential', () => {
    const bad = { ...CREDS, apiKey: `${FAKE_API_KEY}-x` };
    try {
      resolveHttpConfig({ CONDUIT_S2S_SECRET: FAKE_S2S_SECRET, AUTH_MODE: 'env', ...envVars(bad) });
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).not.toContain(bad.apiKey);
      expect((err as Error).message).not.toContain(FAKE_PASSWORD);
    }
  });

  it('rejects unknown AUTH_MODE', () => {
    expect(() => resolveHttpConfig({ CONDUIT_S2S_SECRET: FAKE_S2S_SECRET, AUTH_MODE: 'gatway' })).toThrow(/AUTH_MODE/);
  });

  it.each([' gateway', 'GATEWAY', '\tGateway\n'])('padded/cased AUTH_MODE %j is gateway at startup and per request', (raw) => {
    expect(resolveHttpConfig({ CONDUIT_S2S_SECRET: FAKE_S2S_SECRET, AUTH_MODE: raw }).authMode).toBe('gateway');
    process.env.AUTH_MODE = raw;
    setEnvCredentials(envCreds);
    expect(isGatewayMode()).toBe(true);
    expect(() => resolveCredentials()).toThrow(/X-Webfleet-Account/);
  });

  it('an unparseable AUTH_MODE at request time fails closed (treated as gateway)', () => {
    process.env.AUTH_MODE = 'gatway';
    setEnvCredentials(envCreds);
    expect(() => resolveCredentials()).toThrow(/X-Webfleet-Account/);
  });
});

describe('HTTP transport', () => {
  it('/health is open and reveals no credentials', async () => {
    const port = await listen();
    const res = await realFetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(JSON.parse(body)).toMatchObject({ status: 'ok', mode: 'gateway' });
    expect(body).not.toContain(FAKE_API_KEY);
    expect(body).not.toContain(FAKE_PASSWORD);
  });

  it('rejects /mcp without a valid S2S header', async () => {
    const port = await listen();
    expect((await post(port, listTools, gatewayHeaders)).status).toBe(401);
    expect((await post(port, listTools, { ...gatewayHeaders, 'x-gateway-s2s': mint('wrong-secret-wrong-secret-wrong-secret') })).status).toBe(401);
    expect((await post(port, listTools, { ...gatewayHeaders, 'x-gateway-s2s': mint(FAKE_S2S_SECRET, Math.floor(Date.now() / 1000) - 3600) })).status).toBe(401);
  });

  it('enforces MCP_ALLOWED_HOSTS', async () => {
    const port = await listen({ allowedHosts: new Set(['webfleet-mcp.internal']) });
    expect((await post(port, listTools, { ...gatewayHeaders, 'x-gateway-s2s': mint(FAKE_S2S_SECRET) })).status).toBe(403);
  });

  it('rejects bodies over 1 MiB with 413', async () => {
    const port = await listen();
    const big = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { pad: 'x'.repeat(1024 * 1024) } });
    // The server answers 413 and drops the socket; the client may see the 413 or an EPIPE/reset mid-upload.
    const outcome = await post(port, big, { ...gatewayHeaders, 'x-gateway-s2s': mint(FAKE_S2S_SECRET) }).then(
      (res) => res.status,
      (err: Error & { cause?: { code?: string } }) => err.cause?.code,
    );
    expect([413, 'EPIPE', 'ECONNRESET']).toContain(outcome);
  });

  it('rejects non-POST methods', async () => {
    const port = await listen();
    const res = await realFetch(`http://127.0.0.1:${port}/mcp`, { method: 'GET', headers: { 'x-gateway-s2s': mint(FAKE_S2S_SECRET) } });
    expect(res.status).toBe(405);
  });

  it('gateway mode requires all four X-Webfleet-* headers even when WEBFLEET_* env is set', async () => {
    setEnvCredentials(envCreds);
    const upstream = stubWebfleetOnly();
    const port = await listen();
    const s2s = { 'x-gateway-s2s': mint(FAKE_S2S_SECRET) };
    const none = await post(port, callGroups, s2s);
    expect(none.status).toBe(401);
    expect(await none.text()).toMatch(/X-Webfleet-Account, X-Webfleet-Username, X-Webfleet-Password, X-Webfleet-Api-Key/);
    for (const missing of Object.keys(gatewayHeaders)) {
      const partial = Object.fromEntries(Object.entries(gatewayHeaders).filter(([k]) => k !== missing));
      expect((await post(port, callGroups, { ...s2s, ...partial })).status, missing).toBe(401);
    }
    expect(upstream).toEqual([]);
  });

  it('gateway mode sends the header credentials upstream and ignores env', async () => {
    process.env.AUTH_MODE = 'gateway';
    setEnvCredentials(envCreds);
    const upstream = stubWebfleetOnly();
    const port = await listen();
    const headers = { ...gatewayHeaders, 'x-gateway-s2s': mint(FAKE_S2S_SECRET) };

    const list = (await (await post(port, listTools, headers)).json()) as RpcResult;
    expect(list.result.tools).toHaveLength(TOOL_COUNT);

    const call = (await (await post(port, callGroups, headers)).json()) as RpcResult;
    expect(call.result.isError).toBeFalsy();
    expect(call.result.content?.[0].text).toContain('Contoso Vans');
    expect(upstream).toEqual([{ action: 'showObjectGroups', apiKey: FAKE_API_KEY, authorization: basicOf(FAKE_USERNAME, FAKE_PASSWORD) }]);
  });

  it('concurrent calls with different tenants each reach Webfleet with their own credentials', async () => {
    const tenants = Array.from({ length: 12 }, (_, i) => ({
      account: `tenant-${i}`,
      username: `user-${i}`,
      password: `password-${i}-not-real`,
      apiKey: `tenant-apikey-not-real-00000000000${String(i).padStart(2, '0')}`,
    }));
    const byKey = new Map(tenants.map((t) => [t.apiKey, t]));
    const upstream: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.hostname === '127.0.0.1') return realFetch(input, init);
        const apiKey = url.searchParams.get('apikey') ?? '';
        const tenant = byKey.get(apiKey);
        // Every part of the credential must belong to the same tenant.
        const consistent =
          tenant && url.searchParams.get('account') === tenant.account && new Headers(init?.headers).get('authorization') === basicOf(tenant.username, tenant.password);
        upstream.push(apiKey);
        // Random delay so requests interleave and any shared-credential bug shows up as a mismatch.
        await new Promise((r) => setTimeout(r, Math.random() * 25));
        return jsonResponse([{ objectgroupname: consistent ? tenant.account : 'MISMATCH' }]);
      }),
    );
    const port = await listen();

    const results = await Promise.all(
      tenants.map(async (t) => {
        const res = await post(port, callGroups, {
          'x-webfleet-account': t.account,
          'x-webfleet-username': t.username,
          'x-webfleet-password': t.password,
          'x-webfleet-api-key': t.apiKey,
          'x-gateway-s2s': mint(FAKE_S2S_SECRET),
        });
        return (await res.json()) as RpcResult;
      }),
    );

    results.forEach((r, i) => {
      expect(r.result.isError, r.result.content?.[0].text).toBeFalsy();
      expect(JSON.parse(r.result.content![0].text)[0].objectgroupname).toBe(tenants[i].account);
    });
    expect([...upstream].sort()).toEqual(tenants.map((t) => t.apiKey).sort());
  });

  it('gateway mode rejects a malformed header API key with a clear tool error and no upstream call', async () => {
    const upstream = stubWebfleetOnly();
    const port = await listen();
    const res = (await (await post(port, callGroups, { ...gatewayHeaders, 'x-webfleet-api-key': 'too-short-key', 'x-gateway-s2s': mint(FAKE_S2S_SECRET) })).json()) as RpcResult;
    expect(res.result.isError).toBe(true);
    expect(res.result.content?.[0].text).toMatch(/exactly 36 characters/);
    expect(res.result.content?.[0].text).not.toContain('too-short-key');
    expect(upstream).toEqual([]);
  });

  it('starting in gateway mode locks the process out of env credentials', async () => {
    await listen();
    setEnvCredentials(envCreds);
    expect(() => resolveCredentials()).toThrow(/X-Webfleet-Account/);
  });

  describe('X-Conduit-Tool-Tiers (reduce-only)', () => {
    async function listWith(port: number, extra: Record<string, string>): Promise<string[]> {
      const res = await post(port, listTools, { ...gatewayHeaders, 'x-gateway-s2s': mint(FAKE_S2S_SECRET), ...extra });
      expect(res.status).toBe(200);
      return ((await res.json()) as RpcResult).result.tools!.map((t) => t.name);
    }

    it(`absent header or "read" exposes all ${TOOL_COUNT} read tools`, async () => {
      const port = await listen();
      expect(await listWith(port, {})).toHaveLength(TOOL_COUNT);
      expect(await listWith(port, { 'x-conduit-tool-tiers': 'read' })).toHaveLength(TOOL_COUNT);
      expect(await listWith(port, { 'x-conduit-tool-tiers': 'READ, write, admin' })).toHaveLength(TOOL_COUNT);
    });

    it('an empty or non-read header exposes zero tools and blocks calls', async () => {
      const upstream = stubWebfleetOnly();
      const port = await listen();
      expect(await listWith(port, { 'x-conduit-tool-tiers': '' })).toEqual([]);
      expect(await listWith(port, { 'x-conduit-tool-tiers': 'write,admin' })).toEqual([]);
      const res = (await (await post(port, callGroups, { ...gatewayHeaders, 'x-gateway-s2s': mint(FAKE_S2S_SECRET), 'x-conduit-tool-tiers': '' })).json()) as RpcResult;
      expect(res.result.isError).toBe(true);
      expect(res.result.content?.[0].text).toBe('Error: Unknown tool: webfleet_object_groups_list');
      expect(upstream).toEqual([]);
    });
  });
});
