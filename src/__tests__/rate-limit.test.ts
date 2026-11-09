import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runWithCredentials } from '../client.js';
import { lockGatewayMode, resetGatewayLock } from '../config.js';
import { cacheGet, cacheSet, heldFor, holdOff, MAX_CACHE_TOTAL_CHARS, MAX_SLOT_KEYS, MIN_CACHE_ENTRY_CHARS, rateLimitSizes, takeSlot } from '../rate-limit.js';
import { getDefaultToolset } from '../tools/index.js';
import { always, basicOf, clearEnvCredentials, CREDS, jsonResponse, mockWebfleet, setEnvCredentials, textOf, webfleetError } from './helpers.js';

let now = 1_800_000_000_000;

beforeEach(() => {
  setEnvCredentials();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetGatewayLock();
  clearEnvCredentials();
});

const trips = (range: string) => getDefaultToolset().dispatch('webfleet_trips', { range_pattern: range });

describe('per-account throttle (documented request limits)', () => {
  it('showTripReportExtern (1/minute): a second, different call within the minute is refused locally, then allowed after 60s', async () => {
    const { calls } = mockWebfleet([always(() => jsonResponse([]))]);
    expect((await trips('d-1')).isError).toBeFalsy();

    now += 30_000;
    const refused = await trips('d-2');
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toMatch(/Not sent: WEBFLEET\.connect allows 1 request\/minute for showTripReportExtern.*Retry in 30s/);
    expect(calls).toHaveLength(1);

    now += 30_000;
    expect((await trips('d-2')).isError).toBeFalsy();
    expect(calls).toHaveLength(2);
  });

  it('showObjectReportExtern (6/minute): the 7th distinct call in a minute is refused', async () => {
    const { calls } = mockWebfleet([always(() => jsonResponse([]))]);
    for (let i = 0; i < 6; i++) {
      const res = await getDefaultToolset().dispatch('webfleet_objects_list', { filterstring: `f${i}` });
      expect(res.isError, textOf(res)).toBeFalsy();
      now += 1000;
    }
    const seventh = await getDefaultToolset().dispatch('webfleet_objects_list', { filterstring: 'f6' });
    expect(seventh.isError).toBe(true);
    expect(textOf(seventh)).toMatch(/6 requests\/minute/);
    expect(calls).toHaveLength(6);
  });

  it('limits are per action: another action is unaffected', async () => {
    const { calls } = mockWebfleet([always(() => jsonResponse([]))]);
    await trips('d-1');
    const other = await getDefaultToolset().dispatch('webfleet_object_groups_list', {});
    expect(other.isError, textOf(other)).toBeFalsy();
    expect(calls).toHaveLength(2);
  });

  it('limits are per account: a different tenant has its own budget', async () => {
    lockGatewayMode();
    clearEnvCredentials();
    const { calls } = mockWebfleet([always(() => jsonResponse([]))]);
    const a = { ...CREDS, account: 'tenant-a', apiKey: 'tenant-a-apikey-not-real-00000000000' };
    const b = { ...CREDS, account: 'tenant-b', apiKey: 'tenant-b-apikey-not-real-00000000000' };
    expect((await runWithCredentials(a, () => trips('d-1'))).isError).toBeFalsy();
    expect((await runWithCredentials(b, () => trips('d-1'))).isError).toBeFalsy();
    expect((await runWithCredentials(a, () => trips('d-2'))).isError).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('a shared API key is never a shared budget: each account keeps its own (a partner key spans many tenants)', async () => {
    lockGatewayMode();
    clearEnvCredentials();
    const { calls } = mockWebfleet([always(() => jsonResponse([]))]);
    expect((await runWithCredentials({ ...CREDS, account: 'tenant-a' }, () => trips('d-1'))).isError).toBeFalsy();
    const res = await runWithCredentials({ ...CREDS, account: 'tenant-b' }, () => trips('d-2'));
    expect(res.isError, textOf(res)).toBeFalsy();
    expect(calls).toHaveLength(2);
  });

  it('users of one account share its budget (Webfleet counts the limit per account, not per user)', async () => {
    lockGatewayMode();
    clearEnvCredentials();
    const { calls } = mockWebfleet([always(() => jsonResponse([]))]);
    expect((await runWithCredentials(CREDS, () => trips('d-1'))).isError).toBeFalsy();
    const res = await runWithCredentials({ ...CREDS, username: 'second-user', password: 'second-password-not-real' }, () => trips('d-2'));
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/Not sent/);
    expect(calls).toHaveLength(1);
  });

  it('a wrong-credential caller with the same account name does not consume the real tenant budget', async () => {
    lockGatewayMode();
    clearEnvCredentials();
    const attacker = { ...CREDS, password: 'wrong-password-not-real', apiKey: 'attacker-apikey-not-real-00000000000' };
    const { calls } = mockWebfleet([
      always((call) => (call.headers.authorization === basicOf(CREDS.username, CREDS.password) ? jsonResponse([]) : webfleetError('1101', 'User invalid.', 401))),
    ]);
    expect((await runWithCredentials(attacker, () => trips('d-1'))).isError).toBe(true);
    const victim = await runWithCredentials(CREDS, () => trips('d-2'));
    expect(victim.isError, textOf(victim)).toBeFalsy();
    expect(calls).toHaveLength(2);
  });

  it('a caller with the same account and username but a wrong password does not queue ahead of the real tenant', async () => {
    lockGatewayMode();
    clearEnvCredentials();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    mockWebfleet([
      async (call) => {
        if (call.headers.authorization !== basicOf(CREDS.username, CREDS.password)) await held;
        return jsonResponse([]);
      },
    ]);
    const attacker = runWithCredentials({ ...CREDS, password: 'wrong-password-not-real' }, () => getDefaultToolset().dispatch('webfleet_object_groups_list', {}));
    const victim = runWithCredentials(CREDS, () => getDefaultToolset().dispatch('webfleet_driver_groups_list', {}));
    const outcome = await Promise.race([victim.then(() => 'answered'), new Promise((r) => setTimeout(() => r('queued'), 200))]);
    release();
    await attacker;
    expect(outcome).toBe('answered');
  });

  it('takeSlot records nothing when any key is full', () => {
    expect(takeSlot(['a', 'b'], 1, 60_000, 0)).toBe(0);
    expect(takeSlot(['c', 'b'], 1, 60_000, 10_000)).toBe(50_000);
    expect(takeSlot(['c'], 1, 60_000, 10_000)).toBe(0);
  });
});

describe('response cache (one limit interval, exact credentials and request)', () => {
  it('an identical call within the interval is served from cache without spending budget', async () => {
    const { calls } = mockWebfleet([always(() => jsonResponse([{ tripid: 1 }]))]);
    const first = await trips('d-1');
    now += 59_000;
    const second = await trips('d-1');
    expect(second.isError, textOf(second)).toBeFalsy();
    expect(textOf(second)).toBe(textOf(first));
    expect(calls).toHaveLength(1);
  });

  it('expires after the interval (60s for a 1/minute action)', async () => {
    const { calls } = mockWebfleet([always(() => jsonResponse([]))]);
    await trips('d-1');
    now += 60_000;
    expect((await trips('d-1')).isError).toBeFalsy();
    expect(calls).toHaveLength(2);
  });

  it('is never shared across different credentials', async () => {
    lockGatewayMode();
    clearEnvCredentials();
    const { calls } = mockWebfleet([always(() => jsonResponse([]))]);
    await runWithCredentials(CREDS, () => getDefaultToolset().dispatch('webfleet_object_groups_list', {}));
    await runWithCredentials({ ...CREDS, password: 'another-password-123' }, () => getDefaultToolset().dispatch('webfleet_object_groups_list', {}));
    expect(calls).toHaveLength(2);
  });

  it('does not cache errors', async () => {
    let n = 0;
    const { calls } = mockWebfleet([always(() => (n++ === 0 ? new Response('8000, General system error.', { status: 200 }) : jsonResponse([])))]);
    expect((await getDefaultToolset().dispatch('webfleet_object_groups_list', {})).isError).toBe(true);
    now += 6_000;
    expect((await getDefaultToolset().dispatch('webfleet_object_groups_list', {})).isError).toBeFalsy();
    expect(calls).toHaveLength(2);
  });

  it('evicts the oldest entries beyond the total size cap', () => {
    const big = 1024 * 1024;
    const entries = MAX_CACHE_TOTAL_CHARS / big + 1;
    for (let i = 0; i < entries; i++) cacheSet(`k${i}`, i, big, 60_000, 0);
    expect(cacheGet('k0', 1)).toBeUndefined();
    expect(cacheGet(`k${entries - 1}`, 1)).toEqual({ value: entries - 1 });
  });
});

describe('bounded state (keys come from caller input)', () => {
  it('slot keys whose window has passed are swept', () => {
    for (let i = 0; i < 100; i++) takeSlot([`old-${i}`], 1, 60_000, 0);
    takeSlot(['new'], 1, 60_000, 61_000);
    expect(rateLimitSizes().slotKeys).toBe(1);
  });

  it('the number of slot keys is capped even inside one window', () => {
    for (let i = 0; i < MAX_SLOT_KEYS + 1000; i++) takeSlot([`k-${i}`], 1, 60_000, 0);
    expect(rateLimitSizes().slotKeys).toBeLessThanOrEqual(MAX_SLOT_KEYS);
  });

  it('timeout holds expire and are capped', () => {
    holdOff('h', 10_000, 0);
    expect(heldFor('h', 9_000)).toBe(1_000);
    expect(heldFor('h', 10_000)).toBe(0);
    for (let i = 0; i < MAX_SLOT_KEYS + 10; i++) holdOff(`h-${i}`, 10_000, 0);
    expect(heldFor('h-0', 1)).toBe(0);
    expect(heldFor(`h-${MAX_SLOT_KEYS + 9}`, 1)).toBe(9_999);
  });

  it('tiny cached bodies (empty results) are charged a minimum size, so the entry count is capped', () => {
    for (let i = 0; i < 20_000; i++) cacheSet(`e-${i}`, [], 2, 60_000, 0);
    expect(rateLimitSizes().cacheEntries).toBeLessThanOrEqual(MAX_CACHE_TOTAL_CHARS / MIN_CACHE_ENTRY_CHARS);
  });

  it('expired cache entries are swept (at most once a minute) when a new one is stored', () => {
    for (let i = 0; i < 10; i++) cacheSet(`x-${i}`, i, 10, 1_000, 0);
    cacheSet('fresh', 1, 10, 1_000, 61_000);
    expect(rateLimitSizes().cacheEntries).toBe(1);
  });
});

describe('back-off after a timeout (the request may still be running at Webfleet: error 8015)', () => {
  /** A Webfleet that never answers: the request only ends when its signal aborts. */
  function hangingWebfleet() {
    const fetchMock = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  beforeEach(() => {
    process.env.WEBFLEET_REQUEST_TIMEOUT_MS = '20';
  });
  afterEach(() => {
    delete process.env.WEBFLEET_REQUEST_TIMEOUT_MS;
  });

  it('refuses the next call for these credentials for 10s, then sends again', async () => {
    const hanging = hangingWebfleet();
    const timedOut = await getDefaultToolset().dispatch('webfleet_object_groups_list', {});
    expect(timedOut.isError).toBe(true);
    expect(textOf(timedOut)).toMatch(/timed out/);

    now += 1_000;
    const refused = await getDefaultToolset().dispatch('webfleet_driver_groups_list', {});
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toMatch(/Not sent: the previous WEBFLEET\.connect request for these credentials timed out.*Retry in 9s/);
    expect(hanging).toHaveBeenCalledTimes(1);

    now += 9_000;
    const { calls } = mockWebfleet([always(() => jsonResponse([]))]);
    const sent = await getDefaultToolset().dispatch('webfleet_driver_groups_list', {});
    expect(sent.isError, textOf(sent)).toBeFalsy();
    expect(calls).toHaveLength(1);
  });

  it('does not hold back another tenant', async () => {
    lockGatewayMode();
    clearEnvCredentials();
    hangingWebfleet();
    expect((await runWithCredentials(CREDS, () => getDefaultToolset().dispatch('webfleet_object_groups_list', {}))).isError).toBe(true);
    const { calls } = mockWebfleet([always(() => jsonResponse([]))]);
    const other = { ...CREDS, account: 'tenant-b', apiKey: 'tenant-b-apikey-not-real-00000000000' };
    const res = await runWithCredentials(other, () => getDefaultToolset().dispatch('webfleet_object_groups_list', {}));
    expect(res.isError, textOf(res)).toBeFalsy();
    expect(calls).toHaveLength(1);
  });
});

describe('serialisation per account/username (WEBFLEET.connect error 8015)', () => {
  it('never has two requests for the same user in flight at once', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    mockWebfleet([
      async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return jsonResponse([]);
      },
    ]);
    const results = await Promise.all(
      ['webfleet_object_groups_list', 'webfleet_driver_groups_list', 'webfleet_vehicles_list', 'webfleet_contracts_list'].map((t) => getDefaultToolset().dispatch(t, {})),
    );
    expect(results.every((r) => !r.isError)).toBe(true);
    expect(maxInFlight).toBe(1);
  });
});
