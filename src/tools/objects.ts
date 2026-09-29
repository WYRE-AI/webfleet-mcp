import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ACTIONS } from '../constants.js';
import { objectsListSchema, type ObjectsListInput } from '../schemas.js';
import { formatZodError, withClient, type ToolResult } from './result.js';

export const objectsListTool: Tool = {
  name: 'webfleet_objects_list',
  description:
    'List Webfleet objects or vehicles. report=object calls showObjectReportExtern ' +
    '(all object types, master data, and the latest position; limit 6 requests/minute). ' +
    'report=vehicle calls showVehicleReportExtern (objects of type Vehicle). ' +
    'Read-only. Responses use outputformat=json.',
  inputSchema: {
    type: 'object',
    properties: {
      report: {
        type: 'string',
        enum: ['object', 'vehicle'],
        description: 'object = showObjectReportExtern (default). vehicle = showVehicleReportExtern.',
      },
      filterstring: {
        type: 'string',
        description: 'Arbitrary pattern matched against object data.',
      },
      objectgroupname: {
        type: 'string',
        description: 'Object group name filter.',
      },
      ungroupedonly: {
        type: 'boolean',
        description: 'showObjectReportExtern only. When true, return objects that are not in a group.',
      },
      objectno: {
        type: 'string',
        description: 'Account-unique object number (max 10 characters). Alternative to objectuid.',
      },
      objectuid: {
        type: 'string',
        description: 'Stable object identifier (max 30 characters). Alternative to objectno.',
      },
      externalid: {
        type: 'string',
        description: 'Optional external id filter.',
      },
      columnfilter: {
        type: 'string',
        description: 'Comma-separated result column names. Names are case-sensitive.',
      },
    },
    additionalProperties: false,
  },
};

export async function handleObjectsList(args: unknown): Promise<ToolResult> {
  const parsed = objectsListSchema.safeParse(args ?? {});
  if (!parsed.success) {
    return { content: [{ type: 'text', text: formatZodError(parsed.error) }], isError: true };
  }
  return withClient({
    action: parsed.data.report === 'vehicle' ? ACTIONS.vehicleReport : ACTIONS.objectReport,
    params: objectParams(parsed.data),
  });
}

function objectParams(input: ObjectsListInput): Record<string, string | undefined> {
  return {
    filterstring: input.filterstring,
    objectgroupname: input.objectgroupname,
    objectno: input.objectno,
    objectuid: input.objectuid,
    externalid: input.externalid,
    columnfilter: input.columnfilter,
    ungroupedonly: input.report === 'vehicle' || !input.ungroupedonly ? undefined : 'true',
  };
}
