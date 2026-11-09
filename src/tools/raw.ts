import { ACTION_NAMES, isAllowedAction } from '../actions.js';
import { resolveCredentials, webfleetGet, type QueryValue } from '../client.js';
import { ArgumentError } from '../types.js';
import { READ_ONLY } from './endpoint.js';
import type { ToolArgs, ToolDef } from './types.js';

const MAX_PARAMS = 30;
const MAX_VALUE = 1000;

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

function paramValue(key: string, value: unknown): QueryValue {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && value.length <= MAX_VALUE && !CONTROL.test(value)) return value.trim();
  throw new ArgumentError(`params.${key.slice(0, 64)} must be a non-empty string (max ${MAX_VALUE}, no control characters), a finite number, or a boolean.`);
}

/**
 * Escape hatch for parameters the dedicated tools do not model. It can only
 * call the same fixed allowlist of read actions (actions.ts), goes through
 * the same client (credentials, throttle, cache, redaction), and cannot set
 * account, apikey, username, password, action, or the output parameters.
 */
export const rawRequestTool: ToolDef = {
  tier: 'read',
  tool: {
    name: 'webfleet_raw_request',
    description:
      'Call one of the read-only WEBFLEET.connect actions this server allows, with caller-supplied parameters. ' +
      'Prefer the dedicated webfleet_* tools. account, apikey, action, lang, outputformat, useUTF8, and useISO8601 are set by the server; ' +
      'username and password are only sent via HTTP Basic Auth and are rejected as parameters. Request limits, throttling, and caching are the same as the dedicated tools.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: [...ACTION_NAMES], description: 'WEBFLEET.connect action name.' },
        params: {
          type: 'object',
          description: `Action parameters (at most ${MAX_PARAMS}), e.g. {"objectno": "001", "range_pattern": "d-1"}. Date/times are ISO 8601.`,
          additionalProperties: { type: ['string', 'number', 'boolean'] },
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  handler: async (args: ToolArgs) => {
    if (!isAllowedAction(args.action)) {
      throw new ArgumentError(`"action" must be one of the allowed read-only actions: ${ACTION_NAMES.join(', ')}.`);
    }
    const raw = args.params ?? {};
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new ArgumentError('"params" must be an object.');
    const entries = Object.entries(raw as Record<string, unknown>);
    if (entries.length > MAX_PARAMS) throw new ArgumentError(`"params" accepts at most ${MAX_PARAMS} entries.`);
    const params: Record<string, QueryValue> = {};
    for (const [key, value] of entries) params[key] = paramValue(key, value);
    return webfleetGet(resolveCredentials(), args.action, params);
  },
};
