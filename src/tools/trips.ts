import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ACTIONS, RANGE_PATTERNS } from '../constants.js';
import { tripsSchema } from '../schemas.js';
import { formatZodError, withClient, type ToolResult } from './result.js';

export const tripsTool: Tool = {
  name: 'webfleet_trips',
  description:
    'List trips with showTripReportExtern (limit 1 request/minute). ' +
    'Pass tripid to continue replication from the last trip id, or a date filter. ' +
    'range_pattern uses CSV values (d0, d-1, w0, wf0, m0, ud, …). ' +
    'With useISO8601=true, rangefrom_string and rangeto_string are ISO 8601 timestamps ' +
    'and apply to the trip end time. A range longer than one month needs objectno. ' +
    'Read-only. Responses use outputformat=json.',
  inputSchema: {
    type: 'object',
    properties: {
      objectno: { type: 'string', description: 'Account-unique object number (max 10 characters).' },
      objectuid: { type: 'string', description: 'Stable object identifier (max 30 characters).' },
      objectgroupname: { type: 'string', description: 'Object group name, case-sensitive.' },
      driverno: { type: 'string', description: 'Account-unique driver number. Alternative to driveruid.' },
      driveruid: { type: 'string', description: 'Stable driver identifier. Alternative to driverno.' },
      drivergroupname: { type: 'string', description: 'Driver group name, case-sensitive.' },
      tripid: {
        type: 'string',
        description: 'Last tripid already stored. Returns trips newer than this id (continuous replication).',
      },
      range_pattern: {
        type: 'string',
        enum: [...RANGE_PATTERNS],
        description: 'Relative date range. ud requires rangefrom_string and rangeto_string.',
      },
      rangefrom_string: {
        type: 'string',
        description: 'Range start as ISO 8601, for example 2026-09-01T00:00:00Z. Required with rangeto_string or range_pattern=ud.',
      },
      rangeto_string: {
        type: 'string',
        description: 'Range end as ISO 8601, for example 2026-09-29T23:59:59Z.',
      },
      externalid: { type: 'string', description: 'Optional external id filter.' },
      columnfilter: { type: 'string', description: 'Comma-separated result column names. Names are case-sensitive.' },
    },
    additionalProperties: false,
  },
};

export async function handleTrips(args: unknown): Promise<ToolResult> {
  const parsed = tripsSchema.safeParse(args ?? {});
  if (!parsed.success) {
    return { content: [{ type: 'text', text: formatZodError(parsed.error) }], isError: true };
  }

  const input = parsed.data;
  return withClient({
    action: ACTIONS.tripReport,
    params: {
      objectno: input.objectno,
      objectuid: input.objectuid,
      objectgroupname: input.objectgroupname,
      driverno: input.driverno,
      driveruid: input.driveruid,
      drivergroupname: input.drivergroupname,
      tripid: input.tripid === undefined ? undefined : String(input.tripid),
      range_pattern: input.range_pattern,
      rangefrom_string: input.rangefrom_string,
      rangeto_string: input.rangeto_string,
      externalid: input.externalid,
      columnfilter: input.columnfilter,
    },
  });
}
