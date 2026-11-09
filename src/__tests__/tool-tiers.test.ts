import { describe, expect, it } from 'vitest';
import { DEFAULT_TIERS, narrowTiers, parseToolTiers } from '../config.js';
import { ALL_TOOL_DEFS, buildToolset, pickDeclaredArgs } from '../tools/index.js';
import { textOf } from './helpers.js';

const TOOL_COUNT = 30;

describe('tool tiers', () => {
  it(`exposes exactly ${TOOL_COUNT} tools, all read tier, all read-only annotated`, () => {
    expect(ALL_TOOL_DEFS).toHaveLength(TOOL_COUNT);
    for (const d of ALL_TOOL_DEFS) {
      expect(d.tier, d.tool.name).toBe('read');
      expect(d.tool.annotations, d.tool.name).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    }
  });

  it('names are unique, webfleet_-prefixed, and contain no write verb', () => {
    const names = ALL_TOOL_DEFS.map((d) => d.tool.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) {
      expect(n).toMatch(/^webfleet_[a-z_]+$/);
      expect(n).not.toMatch(/_(insert|update|delete|send|pop|ack|create|reset|remove)(_|$)/);
    }
  });

  it('every input schema is closed (additionalProperties: false)', () => {
    for (const d of ALL_TOOL_DEFS) expect(d.tool.inputSchema.additionalProperties, d.tool.name).toBe(false);
  });

  it('defaults to read', () => {
    expect([...DEFAULT_TIERS]).toEqual(['read']);
    expect([...parseToolTiers(undefined)]).toEqual(['read']);
    expect([...parseToolTiers('  ')]).toEqual(['read']);
    expect(buildToolset(parseToolTiers(undefined)).tools).toHaveLength(TOOL_COUNT);
  });

  it('rejects unknown tier names loudly', () => {
    expect(() => parseToolTiers('read,write')).toThrow(/Invalid WEBFLEET_TOOL_TIERS/);
  });

  it('the tier header can only narrow; empty narrows to nothing', () => {
    const configured = parseToolTiers('read');
    expect([...narrowTiers(configured, undefined)]).toEqual(['read']);
    expect([...narrowTiers(configured, 'read,admin')]).toEqual(['read']);
    expect([...narrowTiers(configured, '')]).toEqual([]);
    expect([...narrowTiers(configured, 'write')]).toEqual([]);
    const empty = buildToolset(narrowTiers(configured, ''));
    expect(empty.tools).toEqual([]);
  });

  it('a tool outside the enabled tiers is indistinguishable from an unknown one', async () => {
    const res = await buildToolset(new Set()).dispatch('webfleet_trips', {});
    expect(res.isError).toBe(true);
    expect(textOf(res)).toBe('Error: Unknown tool: webfleet_trips');
  });

  it('rate-limited tools state their documented limit', () => {
    const desc = (name: string) => ALL_TOOL_DEFS.find((d) => d.tool.name === name)!.tool.description;
    expect(desc('webfleet_trips')).toMatch(/1 request\/minute/);
    expect(desc('webfleet_events')).toMatch(/1 request\/minute/);
    expect(desc('webfleet_objects_list')).toMatch(/6 requests\/minute/);
    expect(desc('webfleet_address_groups_list')).toMatch(/900 requests\/hour/);
  });

  it('the status tool reports configuration without calling Webfleet or returning credentials', async () => {
    process.env.WEBFLEET_ACCOUNT = 'acct';
    process.env.WEBFLEET_USERNAME = 'user';
    process.env.WEBFLEET_PASSWORD = 'status-password-secret';
    process.env.WEBFLEET_API_KEY = 'k'.repeat(36);
    try {
      const text = textOf(await buildToolset(parseToolTiers(undefined)).dispatch('webfleet_status', {}));
      const body = JSON.parse(text);
      expect(body).toMatchObject({ server: 'webfleet-mcp', baseUrl: 'https://csv.webfleet.com/extern', credentials: { usable: true } });
      expect(text).not.toContain('status-password-secret');
      expect(text).not.toContain('k'.repeat(36));
    } finally {
      for (const k of ['WEBFLEET_ACCOUNT', 'WEBFLEET_USERNAME', 'WEBFLEET_PASSWORD', 'WEBFLEET_API_KEY']) delete process.env[k];
    }
  });

  it('the status tool returns isError when credentials are invalid, without leaking them', async () => {
    process.env.WEBFLEET_ACCOUNT = 'acct';
    process.env.WEBFLEET_USERNAME = 'user';
    process.env.WEBFLEET_PASSWORD = 'status-password-secret';
    process.env.WEBFLEET_API_KEY = 'short';
    try {
      const result = await buildToolset(parseToolTiers(undefined)).dispatch('webfleet_status', {});
      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatch(/36 characters/);
      expect(textOf(result)).not.toContain('status-password-secret');
    } finally {
      for (const k of ['WEBFLEET_ACCOUNT', 'WEBFLEET_USERNAME', 'WEBFLEET_PASSWORD', 'WEBFLEET_API_KEY']) delete process.env[k];
    }
  });
});

describe('argument forwarding', () => {
  it('drops undeclared arguments before the handler runs', () => {
    const tool = ALL_TOOL_DEFS.find((d) => d.tool.name === 'webfleet_vehicles_list')!.tool;
    expect(pickDeclaredArgs(tool, { objectno: '001', baseUrl: 'https://evil.example.net', apikey: 'x' })).toEqual({ objectno: '001' });
    expect(pickDeclaredArgs(tool, ['nope'])).toEqual({});
  });
});
