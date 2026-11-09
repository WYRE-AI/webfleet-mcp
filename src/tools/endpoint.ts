/**
 * Builds a read-only tool from a declarative description of one
 * WEBFLEET.connect action, so every tool validates and sends parameters the
 * same way:
 * - strings are trimmed, length-checked against the reference (string(10)
 *   etc.), and may not contain control characters; enums are enforced;
 * - integers are range-checked (out of range is an error, not a cap);
 * - `list` params go on the wire comma-separated, the reference's form for
 *   multi-value parameters (e.g. kpinames=tripstats,orders);
 * - `trueOnly` booleans (ungroupedonly) are sent only as `true`; `numeric`
 *   booleans go out as 1/0;
 * - the shared date range filter is validated per the reference's rules, and
 *   an explicit from/to range is sent with range_pattern=ud;
 * - `columnfilter` (a general parameter) is offered on every tool.
 * WEBFLEET.connect has no paging; `tripid` (continuous replication) is passed
 * through as given and the server never issues follow-up requests.
 */
import type { Tool, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { describeLimit, type Action } from '../actions.js';
import { resolveCredentials, webfleetGet, type QueryValue } from '../client.js';
import { ArgumentError } from '../types.js';
import type { ToolArgs, ToolDef } from './types.js';

export const READ_ONLY: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

type Common = { description: string; required?: boolean };

export type StringParam = Common & { type: 'string'; maxLength?: number; maxBytes?: number; enum?: readonly string[]; pattern?: RegExp; patternHint?: string };
export type IntegerParam = Common & { type: 'integer'; minimum: number; maximum?: number; enum?: readonly number[] };
/** `numeric`: sent as 1/0, for parameters the reference types boolean but documents as 0/1. */
export type BooleanParam = Common & { type: 'boolean'; trueOnly?: boolean; numeric?: boolean };
export type ListParam = Common & { type: 'list'; enum: readonly string[] };
export type Param = StringParam | IntegerParam | BooleanParam | ListParam;

export interface Endpoint {
  name: string;
  action: Action;
  description: string;
  params?: Record<string, Param>;
  /**
   * Adds the shared date range filter parameters. 'pattern' is required and
   * leaves out year/month/day, for actions that require range_pattern.
   */
  dateRange?: 'required' | 'optional' | 'pattern';
  /** With dateRange 'required': the date range may be omitted when this parameter is given. */
  dateRangeUnless?: string;
  /** At least one alternative must be fully present, e.g. [['objectno'], ['objectuid']]. */
  requireOneOf?: readonly (readonly string[])[];
}

const MAX_STRING = 1000;

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

/** ISO 8601 date-time as the reference prefers it (useISO8601=true is always sent). */
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([.,]\d{1,9})?(Z|[+-]\d{2}:\d{2})?$/;

export const RANGE_PATTERNS = [
  'd0', 'd-1', 'd-2', 'd-3', 'd-4', 'd-5', 'd-6',
  'w0', 'w-1', 'w-2', 'w-3',
  'wf0', 'wf-1', 'wf-2', 'wf-3',
  'm0', 'm-1', 'm-2', 'm-3',
  'ud',
] as const;

export const iso = (description: string): StringParam => ({
  type: 'string',
  maxLength: 40,
  pattern: ISO_8601,
  patternHint: 'an ISO 8601 date-time such as 2026-11-01T00:00:00Z',
  description: `${description} ISO 8601, e.g. 2026-11-01T00:00:00Z.`,
});

/** Reference: "Date range filter parameters". */
const DATE_RANGE_PARAMS: Record<string, Param> = {
  range_pattern: {
    type: 'string',
    enum: RANGE_PATTERNS,
    description:
      'Relative date range: d0 today, d-1..d-6 days ago, w0 current week, w-1..w-3 weeks ago, wf0..wf-3 floating 7-day weeks, m0 current month, m-1..m-3 months ago, ud user-defined (needs rangefrom_string and rangeto_string).',
  },
  rangefrom_string: iso('Start of the date range. Use with rangeto_string; range_pattern=ud is sent with them.'),
  rangeto_string: iso('End of the date range. Use with rangefrom_string.'),
  year: { type: 'integer', minimum: 1970, maximum: 2100, description: 'Whole calendar year. Alternative to range_pattern and rangefrom_string/rangeto_string.' },
  month: { type: 'integer', minimum: 1, maximum: 12, description: 'Whole month (1-12). Requires year.' },
  day: { type: 'integer', minimum: 1, maximum: 31, description: 'Whole day (1-31). Requires year and month.' },
};

const COLUMN_FILTER: StringParam = {
  type: 'string',
  maxLength: MAX_STRING,
  description: 'Comma-separated result column names to return (case-sensitive). Reduces response size; unknown names are ignored by Webfleet.',
};

function schemaFor(p: Param): Record<string, unknown> {
  switch (p.type) {
    case 'string':
      return { type: 'string', description: p.description, ...(p.enum ? { enum: [...p.enum] } : { maxLength: p.maxLength ?? MAX_STRING }) };
    case 'integer':
      return {
        type: 'integer',
        description: p.description,
        ...(p.enum ? { enum: [...p.enum] } : { minimum: p.minimum, ...(p.maximum !== undefined ? { maximum: p.maximum } : {}) }),
      };
    case 'boolean':
      return { type: 'boolean', description: p.description };
    case 'list':
      return { type: 'array', description: p.description, minItems: 1, maxItems: p.enum.length, items: { type: 'string', enum: [...p.enum] } };
  }
}

function checkString(value: unknown, key: string, p: StringParam): string {
  if (typeof value !== 'string' || value.trim() === '') throw new ArgumentError(`"${key}" must be a non-empty string.`);
  const s = value.trim();
  const max = p.maxLength ?? MAX_STRING;
  if (s.length > max) throw new ArgumentError(`"${key}" is too long (max ${max} characters).`);
  if (p.maxBytes && Buffer.byteLength(s, 'utf8') > p.maxBytes) throw new ArgumentError(`"${key}" is too long (max ${p.maxBytes} bytes in UTF-8).`);
  if (CONTROL.test(s)) throw new ArgumentError(`"${key}" contains control characters.`);
  if (p.enum && !p.enum.includes(s)) throw new ArgumentError(`"${key}" must be one of: ${p.enum.join(', ')}.`);
  if (p.pattern && !p.pattern.test(s)) throw new ArgumentError(`"${key}" must be ${p.patternHint ?? 'well-formed'}.`);
  if (p.pattern === ISO_8601 && !isValidIsoDateTime(s)) throw new ArgumentError(`"${key}" must be ${p.patternHint ?? 'a valid ISO 8601 date-time'}.`);
  return s;
}

/** Range checks the ISO_8601 shape cannot make: a real calendar date, clock fields, and offset. */
function isValidIsoDateTime(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:[.,]\d+)?(?:Z|[+-](\d{2}):(\d{2}))?$/.exec(s);
  if (!m) return false;
  const [y, mo, d, h, mi, sec] = m.slice(1, 7).map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return false;
  if (h > 23 || mi > 59 || sec > 59) return false;
  return m[7] === undefined || (Number(m[7]) <= 23 && Number(m[8]) <= 59);
}

function queryValue(key: string, p: Param, value: unknown): QueryValue | undefined {
  switch (p.type) {
    case 'string':
      return checkString(value, key, p);
    case 'integer': {
      const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
      if (typeof n !== 'number' || !Number.isInteger(n)) throw new ArgumentError(`"${key}" must be an integer.`);
      if (p.enum && !p.enum.includes(n)) throw new ArgumentError(`"${key}" must be one of: ${p.enum.join(', ')}.`);
      if (n < p.minimum || (p.maximum !== undefined && n > p.maximum)) {
        throw new ArgumentError(`"${key}" must be between ${p.minimum} and ${p.maximum ?? 'any'}.`);
      }
      return n;
    }
    case 'boolean':
      if (typeof value !== 'boolean') throw new ArgumentError(`"${key}" must be true or false.`);
      if (p.trueOnly) return value ? 'true' : undefined;
      return p.numeric ? Number(value) : value;
    case 'list': {
      if (!Array.isArray(value) || value.length === 0) throw new ArgumentError(`"${key}" must be a non-empty array.`);
      const items = value.map((item, i) => checkString(typeof item === 'number' ? String(item) : item, `${key}[${i}]`, { type: 'string', description: '', enum: p.enum }));
      return [...new Set(items)].join(',');
    }
  }
}

const present = (args: ToolArgs, key: string) => args[key] !== undefined && args[key] !== null && args[key] !== '';

function checkDateRange(args: ToolArgs, mode: NonNullable<Endpoint['dateRange']>, unless?: string): void {
  const has = (k: string) => present(args, k);
  const pattern = args.range_pattern;
  if (has('rangefrom_string') !== has('rangeto_string')) throw new ArgumentError('rangefrom_string and rangeto_string must be given together.');
  if (has('range_pattern') && pattern !== 'ud' && has('rangefrom_string')) {
    throw new ArgumentError('range_pattern excludes rangefrom_string/rangeto_string unless range_pattern is ud.');
  }
  if (pattern === 'ud' && !has('rangefrom_string')) throw new ArgumentError('range_pattern=ud requires rangefrom_string and rangeto_string.');
  if (has('month') && !has('year')) throw new ArgumentError('month requires year.');
  if (has('day') && !has('month')) throw new ArgumentError('day requires year and month.');
  if (has('year') && (has('range_pattern') || has('rangefrom_string'))) {
    throw new ArgumentError('year/month/day replace range_pattern and rangefrom_string/rangeto_string; give only one form.');
  }
  if (mode !== 'optional' && !has('range_pattern') && !has('rangefrom_string') && !has('year') && !(unless && has(unless))) {
    const forms = mode === 'pattern' ? 'range_pattern or rangefrom_string + rangeto_string' : 'range_pattern, rangefrom_string + rangeto_string, or year (+ month, day)';
    throw new ArgumentError(`A date range is required: ${forms}${unless ? `, unless ${unless} is given` : ''}.`);
  }
}

export function endpointTool(spec: Endpoint): ToolDef {
  const { year, month, day, ...patternRange } = DATE_RANGE_PARAMS;
  const params: Record<string, Param> = {
    ...(spec.params ?? {}),
    ...(spec.dateRange === 'pattern' ? patternRange : spec.dateRange ? { ...patternRange, year, month, day } : {}),
    columnfilter: COLUMN_FILTER,
  };
  for (const alternative of spec.requireOneOf ?? []) {
    for (const key of alternative) if (!params[key]) throw new Error(`${spec.name}: requireOneOf names unknown parameter "${key}".`);
  }
  if (spec.dateRangeUnless && !params[spec.dateRangeUnless]) throw new Error(`${spec.name}: unknown dateRangeUnless parameter.`);

  const properties: Record<string, object> = {};
  for (const [key, p] of Object.entries(params)) properties[key] = schemaFor(p);
  const required = Object.entries(params).filter(([, p]) => p.required).map(([key]) => key);

  const notes = [
    `Read-only: WEBFLEET.connect ${spec.action} (limit ${describeLimit(spec.action)}; calls over the limit are refused locally, and an identical call inside the limit interval is answered from a short cache).`,
    spec.dateRange === 'required' ? `Requires a date range${spec.dateRangeUnless ? ` unless ${spec.dateRangeUnless} is given` : ''}.` : '',
    spec.dateRange === 'pattern' ? 'Requires range_pattern or rangefrom_string + rangeto_string (year/month/day are not accepted).' : '',
    spec.requireOneOf ? `Requires ${spec.requireOneOf.map((alt) => alt.join(' + ')).join(' or ')}.` : '',
  ].filter(Boolean);

  const tool: Tool = {
    name: spec.name,
    description: `${spec.description} ${notes.join(' ')}`,
    inputSchema: { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false },
    annotations: READ_ONLY,
  };

  return {
    tier: 'read',
    tool,
    handler: (input: ToolArgs) => {
      if (spec.dateRange) checkDateRange(input, spec.dateRange, spec.dateRangeUnless);
      // The reference's explicit-range example always pairs from/to with range_pattern=ud.
      const args = spec.dateRange && present(input, 'rangefrom_string') && !present(input, 'range_pattern') ? { ...input, range_pattern: 'ud' } : input;
      if (spec.requireOneOf && !spec.requireOneOf.some((alt) => alt.every((k) => present(args, k)))) {
        throw new ArgumentError(`${spec.name} requires ${spec.requireOneOf.map((alt) => alt.join(' + ')).join(' or ')}.`);
      }
      const query: Record<string, QueryValue | undefined> = {};
      for (const [key, p] of Object.entries(params)) {
        const value = args[key];
        if (value === undefined || value === null) {
          if (p.required) throw new ArgumentError(`"${key}" is required.`);
          continue;
        }
        query[key] = queryValue(key, p, value);
      }
      return webfleetGet(resolveCredentials(), spec.action, query);
    },
  };
}
