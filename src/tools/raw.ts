import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { rawRequestSchema } from '../schemas.js';
import { formatZodError, withClient, type ToolResult } from './result.js';

export const rawRequestTool: Tool = {
  name: 'webfleet_raw_request',
  description:
    'Call any read-only WEBFLEET.connect action by name (show*, get*, pop*, geocode*, calc*, download*). ' +
    'account and apikey are added as query parameters. Username and password are sent with HTTP Basic Auth and are rejected if placed in params. ' +
    'outputformat=json, useUTF8=true, and useISO8601=true are always set. ' +
    'Write actions (send, insert, update, delete, and similar) are rejected.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'CSV/JSON action name, for example showObjectGroups or getObjectFeatures.',
      },
      params: {
        type: 'object',
        description: 'Additional action parameters. Omit account, apikey, username, and password.',
        additionalProperties: true,
      },
    },
    required: ['action'],
    additionalProperties: false,
  },
};

export async function handleRawRequest(args: unknown): Promise<ToolResult> {
  const parsed = rawRequestSchema.safeParse(args ?? {});
  if (!parsed.success) {
    return { content: [{ type: 'text', text: formatZodError(parsed.error) }], isError: true };
  }

  return withClient({
    action: parsed.data.action,
    params: parsed.data.params,
  });
}
