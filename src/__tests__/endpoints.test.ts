import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACTION_NAMES } from '../actions.js';
import { getDefaultToolset } from '../tools/index.js';
import { actionParams, always, clearEnvCredentials, jsonResponse, mockWebfleet, setEnvCredentials, textOf } from './helpers.js';

/**
 * One row per tool: the arguments a model sends and the exact action and
 * action parameters on the wire (common parameters excluded, order kept).
 * Parameter names follow the WEBFLEET.connect 1.76.0 reference chapters.
 */
type Row = { tool: string; args: Record<string, unknown>; action: string; params: Array<[string, string]> };

const T0 = '2026-11-01T00:00:00Z';
const T1 = '2026-11-02T00:00:00Z';
const UD = { range_pattern: 'ud', rangefrom_string: T0, rangeto_string: T1 };
const UD_WIRE: Array<[string, string]> = [['range_pattern', 'ud'], ['rangefrom_string', T0], ['rangeto_string', T1]];

const ROWS: Row[] = [
  {
    tool: 'webfleet_objects_list',
    args: { filterstring: 'Van', objectgroupname: 'North', ungroupedonly: true, objectno: '001', objectuid: 'uid-1', columnfilter: 'objectno,objectname' },
    action: 'showObjectReportExtern',
    params: [['filterstring', 'Van'], ['objectgroupname', 'North'], ['ungroupedonly', 'true'], ['objectno', '001'], ['objectuid', 'uid-1'], ['columnfilter', 'objectno,objectname']],
  },
  { tool: 'webfleet_vehicles_list', args: { objectgroupname: 'North' }, action: 'showVehicleReportExtern', params: [['objectgroupname', 'North']] },
  { tool: 'webfleet_object_groups_list', args: { objectgroupuid: 'g-1' }, action: 'showObjectGroups', params: [['objectgroupuid', 'g-1']] },
  { tool: 'webfleet_object_group_objects_list', args: { objectgroupname: 'North' }, action: 'showObjectGroupObjects', params: [['objectgroupname', 'North']] },
  {
    tool: 'webfleet_nearest_vehicles',
    args: { latitude: 51364460, longitude: 12399200, priority: 2, maxdistance: 5000 },
    action: 'showNearestVehicles',
    params: [['latitude', '51364460'], ['longitude', '12399200'], ['priority', '2'], ['maxdistance', '5000']],
  },
  { tool: 'webfleet_contracts_list', args: { objectno: '001' }, action: 'showContracts', params: [['objectno', '001']] },
  { tool: 'webfleet_object_features', args: { objectuid: 'uid-1', feature: 'tpms' }, action: 'getObjectFeatures', params: [['objectuid', 'uid-1'], ['feature', 'tpms']] },
  { tool: 'webfleet_trips', args: { objectno: '001', range_pattern: 'd-1' }, action: 'showTripReportExtern', params: [['objectno', '001'], ['range_pattern', 'd-1']] },
  { tool: 'webfleet_trip_summary', args: { objectno: '001', ...UD }, action: 'showTripSummaryReportExtern', params: [['objectno', '001'], ...UD_WIRE] },
  { tool: 'webfleet_tracks', args: { objectuid: 'uid-1', ...UD }, action: 'showTracks', params: [['objectuid', 'uid-1'], ...UD_WIRE] },
  {
    tool: 'webfleet_logbook',
    args: { objectno: '001', modified_since: T0, year: 2026, month: 10 },
    action: 'showLogbook',
    params: [['objectno', '001'], ['modified_since', T0], ['year', '2026'], ['month', '10']],
  },
  { tool: 'webfleet_standstills', args: { objectno: '001', range_pattern: 'w-1' }, action: 'showStandStills', params: [['objectno', '001'], ['range_pattern', 'w-1']] },
  {
    tool: 'webfleet_idle_exceptions',
    args: { drivergroupname: 'Night', range_pattern: 'm0' },
    action: 'showIdleExceptions',
    params: [['drivergroupname', 'Night'], ['range_pattern', 'm0']],
  },
  {
    tool: 'webfleet_working_times',
    args: { driverno: 'D7', timelineType: 2, range_pattern: 'd0' },
    action: 'showWorkingTimes',
    params: [['driverno', 'D7'], ['timelineType', '2'], ['range_pattern', 'd0']],
  },
  {
    tool: 'webfleet_events',
    args: { objectno: '001', eventlevel_cur: 3, resolved: false, acknowledged: true, ...UD },
    action: 'showEventReportExtern',
    params: [['objectno', '001'], ['eventlevel_cur', '3'], ['resolved', 'false'], ['acknowledged', 'true'], ...UD_WIRE],
  },
  { tool: 'webfleet_speeding_events', args: { driveruid: 'du-1', range_pattern: 'wf0' }, action: 'showSpeedingEvents', params: [['driveruid', 'du-1'], ['range_pattern', 'wf0']] },
  {
    tool: 'webfleet_acceleration_events',
    args: { objectno: '001', avg_accel: 650, accelerationtypes: ['1', 3, '1'], range_pattern: 'd-2' },
    action: 'showAccelerationEvents',
    params: [['objectno', '001'], ['avg_accel', '650'], ['accelerationtypes', '1,3'], ['range_pattern', 'd-2']],
  },
  { tool: 'webfleet_drivers_list', args: { driverno: 'D7', ungroupedonly: false }, action: 'showDriverReportExtern', params: [['driverno', 'D7']] },
  { tool: 'webfleet_driver_groups_list', args: { drivergroupname: 'Night' }, action: 'showDriverGroups', params: [['drivergroupname', 'Night']] },
  { tool: 'webfleet_driver_group_drivers_list', args: { drivergroupname: 'Night' }, action: 'showDriverGroupDrivers', params: [['drivergroupname', 'Night']] },
  {
    tool: 'webfleet_object_kpis',
    args: { objectno: '001', kpinames: ['tripstats', 'orders'], level: 'day', range_pattern: 'm-1' },
    action: 'getObjectKPIs',
    params: [['objectno', '001'], ['kpinames', 'tripstats,orders'], ['level', 'day'], ['range_pattern', 'm-1']],
  },
  {
    tool: 'webfleet_driver_kpis',
    args: { driverno: 'D7', kpinames: ['ecostats'], year: 2026 },
    action: 'getDriverKPIs',
    params: [['driverno', 'D7'], ['kpinames', 'ecostats'], ['year', '2026']],
  },
  {
    tool: 'webfleet_addresses_list',
    args: { addressgroupname: 'Depots', addrnr: 'A1' },
    action: 'showAddressReportExtern',
    params: [['addressgroupname', 'Depots'], ['addrnr', 'A1']],
  },
  { tool: 'webfleet_address_groups_list', args: { filterstring: 'Dep' }, action: 'showAddressGroupReportExtern', params: [['filterstring', 'Dep']] },
  { tool: 'webfleet_address_group_addresses_list', args: {}, action: 'showAddressGroupAddressReportExtern', params: [] },
  { tool: 'webfleet_orders_list', args: { orderid: 'ord-1', ordertype: 3 }, action: 'showOrderReportExtern', params: [['orderid', 'ord-1'], ['ordertype', '3']] },
  { tool: 'webfleet_order_waypoints', args: { orderid: 'ord-1' }, action: 'showOrderWaypoints', params: [['orderid', 'ord-1']] },
  { tool: 'webfleet_messages_list', args: { category: 1, range_pattern: 'd0' }, action: 'showMessages', params: [['category', '1'], ['range_pattern', 'd0']] },
  {
    tool: 'webfleet_raw_request',
    args: { action: 'showLogbook', params: { objectno: '001', range_pattern: 'd-1', tripid: 42 } },
    action: 'showLogbook',
    params: [['objectno', '001'], ['range_pattern', 'd-1'], ['tripid', '42']],
  },
];

beforeEach(() => setEnvCredentials());
afterEach(() => {
  vi.unstubAllGlobals();
  clearEnvCredentials();
});

describe('catalog: one tool per documented read action', () => {
  it('covers every allowlisted action exactly once (raw request aside)', () => {
    const catalogRows = ROWS.filter((r) => r.tool !== 'webfleet_raw_request');
    expect(catalogRows.map((r) => r.action).sort()).toEqual([...ACTION_NAMES].sort());
    expect(new Set(catalogRows.map((r) => r.tool)).size).toBe(catalogRows.length);
  });

  it.each(ROWS.map((r) => [r.tool, r] as const))('%s sends the documented action and parameters', async (_name, row) => {
    const { calls } = mockWebfleet([always(() => jsonResponse([{ ok: 1 }]))]);
    const res = await getDefaultToolset().dispatch(row.tool, row.args);
    expect(res.isError, textOf(res)).toBeFalsy();
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('GET');
    expect(calls[0].url.searchParams.getAll('action')).toEqual([row.action]);
    expect(actionParams(calls[0].url)).toEqual(row.params);
  });
});

describe('argument validation (no request is sent)', () => {
  it.each([
    ['webfleet_trips', {}, /date range is required.*unless tripid/],
    ['webfleet_trips', { rangefrom_string: T0 }, /together/],
    ['webfleet_trips', { range_pattern: 'd-1', rangefrom_string: T0, rangeto_string: T1 }, /excludes/],
    ['webfleet_trips', { range_pattern: 'ud' }, /ud requires/],
    ['webfleet_trips', { range_pattern: 'yesterday' }, /range_pattern" must be one of/],
    ['webfleet_trips', { rangefrom_string: '01/11/2026 00:00:00', rangeto_string: T1 }, /ISO 8601/],
    ['webfleet_trips', { month: 10 }, /month requires year/],
    ['webfleet_trips', { year: 2026, range_pattern: 'd0' }, /give only one form/],
    ['webfleet_trips', { tripid: '-5' }, /non-negative integer/],
    ['webfleet_tracks', { range_pattern: 'd0' }, /requires objectno or objectuid/],
    ['webfleet_trip_summary', { range_pattern: 'd0' }, /requires objectno or objectuid/],
    ['webfleet_nearest_vehicles', { latitude: 51364460 }, /requires addrno or latitude \+ longitude/],
    ['webfleet_nearest_vehicles', { latitude: 91_000_000, longitude: 0 }, /between/],
    ['webfleet_working_times', { range_pattern: 'd0' }, /requires driverno or driveruid/],
    ['webfleet_events', { range_pattern: 'd0', eventlevel_cur: 9 }, /must be one of: 0, 1, 2, 3, 4, 5/],
    ['webfleet_object_kpis', { range_pattern: 'd0' }, /"kpinames" is required/],
    ['webfleet_object_kpis', { range_pattern: 'd0', kpinames: ['everything'] }, /must be one of/],
    ['webfleet_order_waypoints', {}, /"orderid" is required/],
    ['webfleet_vehicles_list', { objectno: '12345678901' }, /too long \(max 10/],
    ['webfleet_raw_request', { action: 'deleteDriverExtern' }, /allowed read-only actions/],
    ['webfleet_raw_request', { action: 'popQueueMessagesExtern' }, /allowed read-only actions/],
    ['webfleet_raw_request', { action: 'showObjectGroups', params: { password: 'x' } }, /set by the server/],
    ['webfleet_raw_request', { action: 'showObjectGroups', params: { apikey: 'x' } }, /set by the server/],
    ['webfleet_raw_request', { action: 'showObjectGroups', params: { 'a=b&c': 'x' } }, /Invalid parameter name/],
    ['webfleet_raw_request', { action: 'showObjectGroups', params: { objectno: { nested: 1 } } }, /must be a non-empty string/],
  ])('%s %j is rejected', async (tool, args, why) => {
    const { calls } = mockWebfleet([always(() => jsonResponse([]))]);
    const res = await getDefaultToolset().dispatch(tool, args);
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(why);
    expect(calls).toHaveLength(0);
  });

  it('accepts tripid alone for continuous replication and passes it through unchanged (no paging)', async () => {
    const { calls } = mockWebfleet([always(() => jsonResponse([{ tripid: 1000001 }, { tripid: 1000002 }]))]);
    const res = await getDefaultToolset().dispatch('webfleet_trips', { tripid: '1000000' });
    expect(res.isError, textOf(res)).toBeFalsy();
    expect(calls).toHaveLength(1);
    expect(actionParams(calls[0].url)).toEqual([['tripid', '1000000']]);
    expect(JSON.parse(textOf(res))).toEqual([{ tripid: 1000001 }, { tripid: 1000002 }]);
  });

  it('accepts orderid instead of a date range for orders', async () => {
    mockWebfleet([always(() => jsonResponse([]))]);
    const res = await getDefaultToolset().dispatch('webfleet_orders_list', { orderid: 'ord-1' });
    expect(res.isError, textOf(res)).toBeFalsy();
  });

  it('drops arguments the tool does not declare (no base URL, host, or credential override)', async () => {
    const { calls } = mockWebfleet([always(() => jsonResponse([]))]);
    await getDefaultToolset().dispatch('webfleet_vehicles_list', { baseUrl: 'https://evil.example.net', host: 'evil.example.net', apikey: 'x', account: 'other' });
    expect(calls[0].url.origin).toBe('https://csv.webfleet.com');
    expect(actionParams(calls[0].url)).toEqual([]);
    expect(calls[0].url.searchParams.get('account')).toBe('wfc-test-account');
  });
});
