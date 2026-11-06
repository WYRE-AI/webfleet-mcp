import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACTIONS } from '../src/constants.js';
import { handleObjectsList, objectsListTool } from '../src/tools/objects.js';
import { handleRawRequest, rawRequestTool } from '../src/tools/raw.js';
import { handleStatus, statusTool } from '../src/tools/status.js';
import { handleTrips, tripsTool } from '../src/tools/trips.js';
import { applyEnv, clearEnv, CREDS } from './helpers.js';

function textOf(result: { content: ReadonlyArray<{ type: string; text?: string }> }): string {
  const block = result.content[0];
  if (!block || block.type !== 'text' || typeof block.text !== 'string') {
    throw new Error('expected text content');
  }
  return block.text;
}

function jsonOf(result: { content: ReadonlyArray<{ type: string; text?: string }> }): unknown {
  return JSON.parse(textOf(result));
}

describe('tools', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('names the four read-only tools', () => {
    expect(statusTool.name).toBe('webfleet_status');
    expect(objectsListTool.name).toBe('webfleet_objects_list');
    expect(tripsTool.name).toBe('webfleet_trips');
    expect(rawRequestTool.name).toBe('webfleet_raw_request');
    expect(rawRequestTool.inputSchema.required).toContain('action');
  });

  it('reports configuration without calling the API', async () => {
    clearEnv();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await handleStatus();
    const payload = jsonOf(result) as { ok: boolean; hasCredentials: boolean; actions: { trips: string } };
    expect(payload.ok).toBe(true);
    expect(payload.hasCredentials).toBe(false);
    expect(payload.actions.trips).toBe(ACTIONS.tripReport);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lists objects with showObjectReportExtern and vehicles with showVehicleReportExtern', async () => {
    applyEnv();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([{ objectno: '001' }]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const objects = await handleObjectsList({ filterstring: 'Demo', ungroupedonly: true });
    expect(objects.isError).toBeUndefined();
    const objectUrl = new URL(String((fetchMock.mock.calls as unknown[][])[0]?.[0]));
    expect(objectUrl.searchParams.get('action')).toBe(ACTIONS.objectReport);
    expect(objectUrl.searchParams.get('filterstring')).toBe('Demo');
    expect(objectUrl.searchParams.get('ungroupedonly')).toBe('true');
    expect(objectUrl.searchParams.get('outputformat')).toBe('json');
    expect(objectUrl.toString()).not.toContain(CREDS.password);

    await handleObjectsList({ report: 'vehicle', objectno: '001' });
    const vehicleUrl = new URL(String((fetchMock.mock.calls as unknown[][])[1]?.[0]));
    expect(vehicleUrl.searchParams.get('action')).toBe(ACTIONS.vehicleReport);
    expect(vehicleUrl.searchParams.get('objectno')).toBe('001');
    expect(vehicleUrl.searchParams.has('ungroupedonly')).toBe(false);

    const rejected = await handleObjectsList({ report: 'vehicle', ungroupedonly: true });
    expect(rejected.isError).toBe(true);
    expect(textOf(rejected)).toMatch(/ungroupedonly/);
  });

  it('requires credentials before listing objects', async () => {
    clearEnv();
    const result = await handleObjectsList({});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/credentials/i);
  });

  it('calls showTripReportExtern with a date range and rejects an empty filter', async () => {
    applyEnv();
    const fetchMock = vi.fn(async () => new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const missing = await handleTrips({});
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toMatch(/showTripReportExtern/);
    expect(fetchMock).not.toHaveBeenCalled();

    const ok = await handleTrips({
      objectno: '001',
      range_pattern: 'ud',
      rangefrom_string: '2026-09-01T00:00:00Z',
      rangeto_string: '2026-09-29T23:59:59Z',
    });
    expect(ok.isError).toBeUndefined();
    const url = new URL(String((fetchMock.mock.calls as unknown[][])[0]?.[0]));
    expect(url.searchParams.get('action')).toBe(ACTIONS.tripReport);
    expect(url.searchParams.get('range_pattern')).toBe('ud');
    expect(url.searchParams.get('rangefrom_string')).toBe('2026-09-01T00:00:00Z');
    expect(url.searchParams.get('useISO8601')).toBe('true');
  });

  it('rejects a range_pattern that is not in the CSV reference', async () => {
    applyEnv();
    const result = await handleTrips({ range_pattern: 'Dm1' });
    expect(result.isError).toBe(true);
  });

  it('uses the raw action escape hatch for reads and blocks writes', async () => {
    applyEnv();
    const fetchMock = vi.fn(async () => new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const write = await handleRawRequest({ action: 'sendTextMessageExtern', params: { objectno: '001' } });
    expect(write.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();

    const leaked = await handleRawRequest({ action: 'showObjectGroups', params: { username: 'nope' } });
    expect(leaked.isError).toBe(true);
    expect(textOf(leaked)).toMatch(/Basic Auth/);

    const read = await handleRawRequest({ action: 'showObjectGroups' });
    expect(read.isError).toBeUndefined();
    const url = new URL(String((fetchMock.mock.calls as unknown[][])[0]?.[0]));
    expect(url.searchParams.get('action')).toBe('showObjectGroups');
    expect(url.searchParams.get('account')).toBe(CREDS.account);
    expect(url.searchParams.has('username')).toBe(false);
    expect(url.searchParams.has('password')).toBe(false);
  });

  it('surfaces a Webfleet error code as a tool error', async () => {
    applyEnv();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('8011,Request quota reached', {
        status: 200,
        headers: { 'x-webfleet-errorcode': '8011', 'x-webfleet-errormessage': 'Request quota reached' },
      })),
    );
    const result = await handleObjectsList({});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/rate limit/i);
  });
});
