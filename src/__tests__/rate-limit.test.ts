import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runWithCredentials } from '../client.js';
import { lockGatewayMode, resetGatewayLock } from '../config.js';
import { cacheGet, cacheSet, MAX_CACHE_TOTAL_CHARS, takeSlot } from '../rate-limit.js';
import { getDefaultToolset } from '../tools/index.js';
import { always, clearEnvCredentials, CREDS, jsonResponse, mockWebfleet, setEnvCredentials, textOf } from './helpers.js';

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

  it('a shared API key is throttled across accounts too (the reference does not say which one Webfleet counts)', async () => {
    lockGatewayMode();
    clearEnvCredentials();
    const { calls } = mockWebfleet([always(() => jsonResponse([]))]);
    expect((await runWithCredentials({ ...CREDS, account: 'tenant-a' }, () => trips('d-1'))).isError).toBeFalsy();
    const res = await runWithCredentials({ ...CREDS, account: 'tenant-b' }, () => trips('d-2'));
    expect(res.isError).toBe(true);
    expect(calls).toHaveLength(1);
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
