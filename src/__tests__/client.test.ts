import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildUrl, resolveCredentials, runWithCredentials } from '../client.js';
import { lockGatewayMode, resetGatewayLock } from '../config.js';
import { createServer } from '../server.js';
import { getDefaultToolset } from '../tools/index.js';
import { logger } from '../utils/logger.js';
import { VERSION } from '../version.js';
import {
  always,
  basicOf,
  clearEnvCredentials,
  CREDS,
  FAKE_ACCOUNT,
  FAKE_API_KEY,
  FAKE_ENV_API_KEY,
  FAKE_ENV_PASSWORD,
  FAKE_PASSWORD,
  FAKE_USERNAME,
  jsonResponse,
  mockWebfleet,
  setEnvCredentials,
  textOf,
  webfleetError,
} from './helpers.js';

const GROUPS = 'webfleet_object_groups_list';

let logSpy: ReturnType<typeof vi.spyOn>;
const logged = () => logSpy.mock.calls.map((c) => c.map(String).join(' ')).join('\n');

beforeEach(() => {
  setEnvCredentials();
  process.env.LOG_LEVEL = 'debug';
  logSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  logSpy.mockRestore();
  resetGatewayLock();
  clearEnvCredentials();
  process.env.LOG_LEVEL = 'error';
});

describe('upstream request', () => {
  it('sends exactly Authorization: Basic, accept, user-agent, with redirect: manual, GET only', async () => {
    const { calls } = mockWebfleet([always(() => jsonResponse([{ objectgroupname: 'Vans', objectcount: '3' }]))]);
    const res = await getDefaultToolset().dispatch(GROUPS, {});
    expect(res.isError, textOf(res)).toBeFalsy();
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('GET');
    expect(calls[0].headers).toEqual({
      authorization: basicOf(FAKE_USERNAME, FAKE_PASSWORD),
      accept: 'application/json',
      'user-agent': `webfleet-mcp/${VERSION}`,
    });
    expect(calls[0].redirect).toBe('manual');
  });

  it('matches the reference Basic Auth example (wfcuser:yourpwd)', () => {
    expect(basicOf('wfcuser', 'yourpwd')).toBe('Basic d2ZjdXNlcjp5b3VycHdk');
  });

  it('hits https://csv.webfleet.com/extern with the common parameters in the reference order, and no username/password in the URL', async () => {
    const { calls } = mockWebfleet([always(() => jsonResponse([]))]);
    await getDefaultToolset().dispatch(GROUPS, { objectgroupname: 'Vans' });
    const url = calls[0].url;
    expect(url.origin).toBe('https://csv.webfleet.com');
    expect(url.pathname).toBe('/extern');
    expect([...url.searchParams.entries()]).toEqual([
      ['lang', 'en'],
      ['account', FAKE_ACCOUNT],
      ['apikey', FAKE_API_KEY],
      ['action', 'showObjectGroups'],
      ['outputformat', 'json'],
      ['useUTF8', 'true'],
      ['useISO8601', 'true'],
      ['objectgroupname', 'Vans'],
    ]);
    expect(url.href).not.toContain(FAKE_PASSWORD);
    expect(url.href).not.toContain(FAKE_USERNAME);
    expect(url.searchParams.has('username')).toBe(false);
    expect(url.searchParams.has('password')).toBe(false);
  });

  it('reports the package version in user-agent', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('URL building is fixed-host and injection-proof', () => {
  it('refuses any action outside the read-only allowlist', () => {
    for (const action of ['insertDriverExtern', 'updateVehicle', 'deleteAddressExtern', 'sendOrderExtern', 'popQueueMessagesExtern', 'ackQueueMessagesExtern', 'createQueueExtern', '../extern', 'showObjectGroups&action=deleteUser']) {
      expect(() => buildUrl(CREDS, action), action).toThrow(/not an allowed read-only/);
    }
  });

  it('refuses reserved and credential parameter names in any case', () => {
    for (const key of ['account', 'ApiKey', 'action', 'username', 'PASSWORD', 'sessiontoken', 'lang', 'outputformat', 'useISO8601', 'useutf8']) {
      expect(() => buildUrl(CREDS, 'showObjectGroups', { [key]: 'x' }), key).toThrow(/set by the server/);
    }
    expect(() => buildUrl(CREDS, 'showObjectGroups', { 'a&b': 'x' })).toThrow(/Invalid parameter name/);
    expect(() => buildUrl(CREDS, 'showObjectGroups', { '../x': 'x' })).toThrow(/Invalid parameter name/);
  });

  it('percent-encodes traversal and separator characters in values so they stay one parameter on /extern', async () => {
    const { calls } = mockWebfleet([always(() => jsonResponse([]))]);
    const evil = '../../admin?x=1&action=deleteUser#frag/..\\%2e%2e';
    const res = await getDefaultToolset().dispatch('webfleet_vehicles_list', { filterstring: evil });
    expect(res.isError, textOf(res)).toBeFalsy();
    const url = calls[0].url;
    expect(url.pathname).toBe('/extern');
    expect(url.hash).toBe('');
    expect(url.searchParams.getAll('action')).toEqual(['showVehicleReportExtern']);
    expect(url.searchParams.get('filterstring')).toBe(evil);
    expect(url.search).toContain('filterstring=..%2F..%2Fadmin%3Fx%3D1%26action%3DdeleteUser%23frag%2F..%5C%252e%252e');
  });

  it('rejects control characters in IDs before any request', async () => {
    const { calls } = mockWebfleet([always(() => jsonResponse([]))]);
    const res = await getDefaultToolset().dispatch('webfleet_vehicles_list', { objectno: 'a\r\nb' });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/control characters/);
    expect(calls).toHaveLength(0);
  });
});

describe('credential validation', () => {
  it.each([
    [{ apiKey: 'too-short' }, /API key is invalid.*36/],
    [{ apiKey: `${FAKE_API_KEY}x` }, /API key is invalid/],
    [{ apiKey: 'test apikey with spaces 000000000000' }, /API key is invalid/],
    [{ username: 'user:name' }, /username is invalid/],
    [{ password: 'pa\r\nss' }, /password is invalid/],
  ])('rejects %j without calling upstream and without echoing the value', async (override, why) => {
    setEnvCredentials({ ...CREDS, ...override });
    const { calls } = mockWebfleet([always(() => jsonResponse([]))]);
    const res = await getDefaultToolset().dispatch(GROUPS, {});
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(why);
    for (const v of Object.values(override)) expect(textOf(res)).not.toContain(v);
    expect(calls).toHaveLength(0);
  });

  it('names every missing env variable in stdio mode', async () => {
    clearEnvCredentials();
    const { calls } = mockWebfleet();
    const res = await getDefaultToolset().dispatch(GROUPS, {});
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/WEBFLEET_ACCOUNT, WEBFLEET_USERNAME, WEBFLEET_PASSWORD, WEBFLEET_API_KEY/);
    expect(calls).toHaveLength(0);
  });
});

describe('redirects', () => {
  it.each([301, 302, 303, 307, 308])('refuses HTTP %i and never follows Location', async (status) => {
    const { calls } = mockWebfleet([always(() => new Response(null, { status, headers: { location: 'https://evil.example.net/steal' } }))]);
    const res = await getDefaultToolset().dispatch(GROUPS, {});
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(new RegExp(`redirect.*HTTP ${status}`, 'i'));
    expect(calls).toHaveLength(1);
    expect(calls[0].url.hostname).toBe('csv.webfleet.com');
  });
});

describe('error mapping', () => {
  it.each([
    ['1106', 'Authentication failed. check account/username/password.', /account, username, or password is wrong/],
    ['8014', 'External requests are not allowed for that account/user.', /WEBFLEET\.connect access right/],
    ['8011', 'Request quota reached.', /quota reached.*wait before retrying/],
    ['8015', 'Account / username busy processing other request.', /wait at least 10 seconds/],
    ['55', 'Action is not valid', /not available/],
    ['60', 'General error.', /code 60\)\./],
  ])('code %s surfaces HTTP status, vendor code, vendor message, and a hint', async (code, message, hint) => {
    mockWebfleet([always(() => webfleetError(code, message))]);
    const res = await getDefaultToolset().dispatch(GROUPS, {});
    expect(res.isError).toBe(true);
    const text = textOf(res);
    expect(text).toContain(`showObjectGroups (HTTP 200, code ${code})`);
    expect(text).toMatch(hint);
    expect(text).toContain(message);
  });

  it('reads the JSON error object form ({errorCode, errorMsg})', async () => {
    mockWebfleet([always(() => jsonResponse({ errorCode: 8011, errorMsg: 'request quota reached' }))]);
    const res = await getDefaultToolset().dispatch(GROUPS, {});
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/code 8011/);
    expect(textOf(res)).toContain('request quota reached');
  });

  it('reads the plain-text "id, description" form without headers', async () => {
    mockWebfleet([always(() => new Response('1101, User invalid (does not exist).', { status: 200 }))]);
    const res = await getDefaultToolset().dispatch(GROUPS, {});
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/code 1101.*password is wrong/);
  });

  it.each(['63', '9198'])('treats "no data" code %s as an empty result, not an error', async (code) => {
    mockWebfleet([always(() => webfleetError(code, 'document is empty'))]);
    const res = await getDefaultToolset().dispatch(GROUPS, {});
    expect(res.isError, textOf(res)).toBeFalsy();
    expect(JSON.parse(textOf(res))).toEqual([]);
  });

  it('maps a non-2xx response with a JSON body to an error (never returns it as data)', async () => {
    mockWebfleet([always(() => jsonResponse([{ looks: 'like data' }], 503))]);
    const res = await getDefaultToolset().dispatch(GROUPS, {});
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/HTTP 503/);
  });

  it('maps HTTP 401 from a proxy with a non-JSON body', async () => {
    mockWebfleet([always(() => new Response('<html>Unauthorized</html>', { status: 401 }))]);
    const res = await getDefaultToolset().dispatch(GROUPS, {});
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/HTTP 401.*password is wrong/);
  });

  it('maps a network failure to a clear error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    const res = await getDefaultToolset().dispatch(GROUPS, {});
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/could not reach/i);
  });

  it('keeps a safe system error code from the network failure cause', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }); }));
    const res = await getDefaultToolset().dispatch(GROUPS, {});
    expect(textOf(res)).toMatch(/could not reach WEBFLEET\.connect \(network error, ENOTFOUND\)/i);
  });

  it('drops a cause code that is not a plain system error code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed', { cause: { code: `bad ${FAKE_PASSWORD}` } }); }));
    const res = await getDefaultToolset().dispatch(GROUPS, {});
    expect(textOf(res)).toMatch(/\(network error\)/);
    expect(textOf(res)).not.toContain(FAKE_PASSWORD);
  });

  it('refuses a non-JSON success body', async () => {
    mockWebfleet([always(() => new Response('"objectno";"objectname"\n"1";"Van"', { status: 200 }))]);
    const res = await getDefaultToolset().dispatch(GROUPS, {});
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/non-JSON/);
  });

  it('caps the upstream body while streaming', async () => {
    process.env.WEBFLEET_MAX_UPSTREAM_BYTES = '1024';
    try {
      mockWebfleet([always(() => jsonResponse([{ pad: 'x'.repeat(4096) }]))]);
      const res = await getDefaultToolset().dispatch(GROUPS, {});
      expect(res.isError).toBe(true);
      expect(textOf(res)).toMatch(/exceeded 1024 bytes/);
    } finally {
      delete process.env.WEBFLEET_MAX_UPSTREAM_BYTES;
    }
  });
});

describe('credentials never leak', () => {
  const basic = basicOf(FAKE_USERNAME, FAKE_PASSWORD).slice('Basic '.length);

  it('the password, API key, and Basic token are redacted when the vendor echoes them, and absent from logs', async () => {
    mockWebfleet([always(() => webfleetError('60', `bad request apikey=${FAKE_API_KEY} pw ${FAKE_PASSWORD} auth ${basic}`))]);
    const res = await getDefaultToolset().dispatch(GROUPS, {});
    const text = textOf(res);
    expect(res.isError).toBe(true);
    for (const secret of [FAKE_API_KEY, FAKE_PASSWORD, basic]) {
      expect(text).not.toContain(secret);
      expect(logged()).not.toContain(secret);
    }
    expect(text).toContain('[REDACTED]');
  });

  it('is redacted from successful output that happens to contain it', async () => {
    mockWebfleet([always(() => jsonResponse([{ note: `key ${FAKE_API_KEY}`, password: 'p4ss-in-a-row' }]))]);
    const text = textOf(await getDefaultToolset().dispatch(GROUPS, {}));
    expect(text).not.toContain(FAKE_API_KEY);
    expect(text).not.toContain('p4ss-in-a-row');
  });

  it('gateway (header) credentials are redacted from errors and logs too', async () => {
    lockGatewayMode();
    clearEnvCredentials();
    const gw = { account: 'gw-account', username: 'gw-user', password: 'gw-password-xyz-123', apiKey: 'gw-apikey-not-real-00000000000000000' };
    mockWebfleet([always(() => webfleetError('60', `echo ${gw.password} ${gw.apiKey}`))]);
    const res = await runWithCredentials(gw, () => getDefaultToolset().dispatch(GROUPS, {}));
    expect(textOf(res)).not.toContain(gw.password);
    expect(textOf(res)).not.toContain(gw.apiKey);
    expect(logged()).not.toContain(gw.password);
    expect(logged()).not.toContain(gw.apiKey);
  });

  it('the logger redacts the per-request credentials in scope', () => {
    lockGatewayMode();
    clearEnvCredentials();
    const gw = { account: 'gw-account', username: 'gw-user', password: 'short-pw9', apiKey: 'gw-apikey-not-real-00000000000000000' };
    runWithCredentials(gw, () => logger.warn(`message with ${gw.password} and ${gw.apiKey}`, { echoed: gw.password }));
    expect(logSpy).toHaveBeenCalled();
    expect(logged()).not.toContain(gw.password);
    expect(logged()).not.toContain(gw.apiKey);
    expect(logged()).toContain('[REDACTED]');
  });

  it('an unexpected internal error never echoes raw error text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error(`socket closed for ${FAKE_PASSWORD}`); }));
    const res = await getDefaultToolset().dispatch(GROUPS, {});
    expect(res.isError).toBe(true);
    expect(textOf(res)).not.toContain(FAKE_PASSWORD);
    expect(logged()).not.toContain(FAKE_PASSWORD);
  });

  it('nothing logged during a full successful call contains a credential', async () => {
    mockWebfleet([always(() => jsonResponse([]))]);
    await getDefaultToolset().dispatch(GROUPS, {});
    expect(logSpy).toHaveBeenCalled();
    for (const secret of [FAKE_API_KEY, FAKE_PASSWORD, basic]) expect(logged()).not.toContain(secret);
  });
});

describe('credential source', () => {
  it('stdio/env mode reads WEBFLEET_*', () => {
    expect(resolveCredentials()).toEqual(CREDS);
  });

  it('gateway mode never falls back to the environment', async () => {
    setEnvCredentials({ ...CREDS, password: FAKE_ENV_PASSWORD, apiKey: FAKE_ENV_API_KEY });
    process.env.AUTH_MODE = 'gateway';
    expect(() => resolveCredentials()).toThrow(/X-Webfleet-Account/);
    const { calls } = mockWebfleet([always(() => jsonResponse([]))]);
    const res = await getDefaultToolset().dispatch(GROUPS, {});
    expect(res.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('gateway mode uses the per-request credentials, not env', async () => {
    setEnvCredentials({ ...CREDS, password: FAKE_ENV_PASSWORD, apiKey: FAKE_ENV_API_KEY });
    lockGatewayMode();
    const { calls } = mockWebfleet([always(() => jsonResponse([]))]);
    const res = await runWithCredentials(CREDS, () => getDefaultToolset().dispatch(GROUPS, {}));
    expect(res.isError, textOf(res)).toBeFalsy();
    expect(calls[0].url.searchParams.get('apikey')).toBe(FAKE_API_KEY);
    expect(calls[0].headers.authorization).toBe(basicOf(FAKE_USERNAME, FAKE_PASSWORD));
  });
});

describe('end to end over MCP (mocked upstream)', () => {
  it('tools/list returns 30 read-only tools and tools/call round-trips a read', async () => {
    const { calls } = mockWebfleet([
      (call) =>
        call.url.searchParams.get('action') === 'showVehicleReportExtern'
          ? jsonResponse([{ objectno: '001', objectname: 'Van 1', licenseplatenumber: 'AB-123-C', odometer: 123456 }])
          : undefined,
    ]);
    const server = createServer(getDefaultToolset());
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: 'e2e', version: '0.0.0' });
    await client.connect(clientSide);
    try {
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(30);
      expect(tools.every((t) => t.annotations?.readOnlyHint === true && t.annotations?.destructiveHint === false)).toBe(true);

      const result = (await client.callTool({ name: 'webfleet_vehicles_list', arguments: { objectno: '001' } })) as {
        isError?: boolean;
        content: Array<{ type: string; text: string }>;
      };
      expect(result.isError).toBeFalsy();
      expect(JSON.parse(result.content[0].text)).toEqual([{ objectno: '001', objectname: 'Van 1', licenseplatenumber: 'AB-123-C', odometer: 123456 }]);
      expect(calls).toHaveLength(1);
      expect(calls[0].url.searchParams.get('objectno')).toBe('001');
    } finally {
      await client.close();
      await server.close();
    }
  });
});
