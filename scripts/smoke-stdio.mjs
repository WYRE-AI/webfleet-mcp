#!/usr/bin/env node
// Spawns the built stdio server (dist/index.js) and checks the tool surface
// plus credential and action handling. Makes no network call: the only tool
// calls made here are ones the server must answer or refuse before any
// request (local status, a malformed API key, an invalid date range, a
// non-allowlisted raw action). Upstream round-trips are covered by the mocked
// tests in src/__tests__.
// Usage: npm run build && npm run smoke
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const PASSWORD = 'smoke-password-not-real';
const BAD_API_KEY = 'smoke-short-key';

const EXPECTED = [
  'webfleet_acceleration_events',
  'webfleet_address_group_addresses_list',
  'webfleet_address_groups_list',
  'webfleet_addresses_list',
  'webfleet_contracts_list',
  'webfleet_driver_group_drivers_list',
  'webfleet_driver_groups_list',
  'webfleet_driver_kpis',
  'webfleet_drivers_list',
  'webfleet_events',
  'webfleet_idle_exceptions',
  'webfleet_logbook',
  'webfleet_messages_list',
  'webfleet_nearest_vehicles',
  'webfleet_object_features',
  'webfleet_object_group_objects_list',
  'webfleet_object_groups_list',
  'webfleet_object_kpis',
  'webfleet_objects_list',
  'webfleet_order_waypoints',
  'webfleet_orders_list',
  'webfleet_raw_request',
  'webfleet_speeding_events',
  'webfleet_standstills',
  'webfleet_status',
  'webfleet_tracks',
  'webfleet_trip_summary',
  'webfleet_trips',
  'webfleet_vehicles_list',
  'webfleet_working_times',
];

function fail(message) {
  console.error(`smoke-stdio: FAIL - ${message}`);
  process.exitCode = 1;
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['dist/index.js'],
  env: {
    PATH: process.env.PATH ?? '',
    LOG_LEVEL: 'error',
    WEBFLEET_ACCOUNT: 'smoke-account',
    WEBFLEET_USERNAME: 'smoke-user',
    WEBFLEET_PASSWORD: PASSWORD,
    WEBFLEET_API_KEY: BAD_API_KEY,
  },
});
const client = new Client({ name: 'smoke', version: '0.0.0' });
const text = (r) => r.content?.[0]?.text ?? '';

try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  if (tools.length !== EXPECTED.length) fail(`expected ${EXPECTED.length} tools, got ${tools.length}`);
  if (JSON.stringify(names) !== JSON.stringify(EXPECTED)) fail(`tool names differ: ${names.join(', ')}`);
  if (!tools.every((t) => t.annotations?.readOnlyHint === true && t.annotations?.destructiveHint === false)) fail('a tool is not annotated read-only');

  const status = await client.callTool({ name: 'webfleet_status', arguments: {} });
  if (status.isError || !/csv\.webfleet\.com\/extern/.test(text(status))) fail(`status failed: ${text(status).slice(0, 200)}`);
  if (text(status).includes(PASSWORD)) fail('password leaked into status output');

  const refused = await client.callTool({ name: 'webfleet_object_groups_list', arguments: {} });
  if (!refused.isError || !/exactly 36 characters/.test(text(refused))) fail(`malformed API key was not refused: ${text(refused).slice(0, 200)}`);
  if (text(refused).includes(BAD_API_KEY) || text(refused).includes(PASSWORD)) fail('credential leaked into tool output');

  const noRange = await client.callTool({ name: 'webfleet_trips', arguments: {} });
  if (!noRange.isError || !/date range is required/.test(text(noRange))) fail(`missing date range was not refused: ${text(noRange).slice(0, 200)}`);

  const write = await client.callTool({ name: 'webfleet_raw_request', arguments: { action: 'deleteDriverExtern' } });
  if (!write.isError || !/allowed read-only actions/.test(text(write))) fail(`write action was not refused: ${text(write).slice(0, 200)}`);

  const unknown = await client.callTool({ name: 'webfleet_drivers_delete', arguments: {} });
  if (!unknown.isError) fail('unknown tool did not error');

  if (!process.exitCode) console.log(`smoke-stdio: OK (${tools.length} read-only tools; bad key, missing range, and write action refused without a network call)`);
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
} finally {
  await client.close().catch(() => {});
}
