import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { getCredentials } from '../credentials.js';
import { createWebfleetClient, type WebfleetCall } from '../client.js';
import { toMcpError } from '../errors.js';

export type ToolResult = CallToolResult;

export function toolText(value: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  };
}

export function toolError(message: string): ToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'input';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

export async function withClient(call: WebfleetCall): Promise<ToolResult> {
  const loaded = getCredentials();
  if (!loaded.credentials) {
    return toolError(
      loaded.error ??
        'No WEBFLEET.connect credentials configured. Set WEBFLEET_ACCOUNT, WEBFLEET_API_KEY (36 characters), WEBFLEET_USERNAME, and WEBFLEET_PASSWORD.',
    );
  }

  try {
    const client = createWebfleetClient(loaded.credentials);
    const data = await client.call(call);
    return toolText(data);
  } catch (error) {
    return toolError(toMcpError(error).message);
  }
}
