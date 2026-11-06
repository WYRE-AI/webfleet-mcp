import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ACTIONS, API_PATH, API_REFERENCE, DEFAULT_HOST, SERVER_NAME, SERVER_VERSION } from '../constants.js';
import { getCredentials } from '../credentials.js';
import { toolText, type ToolResult } from './result.js';

export const statusTool: Tool = {
  name: 'webfleet_status',
  description:
    'Report WEBFLEET.connect MCP configuration. This does not call the Webfleet API. ' +
    'Credentials stay out of the response. Username and password use HTTP Basic Auth; ' +
    'account and the 36-character apikey are query parameters.',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
};

export async function handleStatus(): Promise<ToolResult> {
  const loaded = getCredentials();
  const host = loaded.credentials?.host ?? DEFAULT_HOST;

  return toolText({
    ok: true,
    server: SERVER_NAME,
    version: SERVER_VERSION,
    reference: API_REFERENCE,
    baseUrl: `https://${host}${API_PATH}`,
    host,
    outputformat: 'json',
    hasCredentials: Boolean(loaded.credentials),
    ...(loaded.error ? { credentialError: loaded.error } : {}),
    auth: {
      query: ['account', 'apikey'],
      header: 'Authorization: Basic base64(username:password)',
    },
    actions: {
      objects: ACTIONS.objectReport,
      vehicles: ACTIONS.vehicleReport,
      trips: ACTIONS.tripReport,
    },
    tools: ['webfleet_status', 'webfleet_objects_list', 'webfleet_trips', 'webfleet_raw_request'],
  });
}
