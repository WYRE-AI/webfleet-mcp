import { describe, expect, it } from 'vitest';
import { maxUpstreamBytes } from '../config.js';
import { redactText, redactValue, REDACTED, renderSafe } from '../redact.js';
import { basicOf, FAKE_API_KEY, FAKE_PASSWORD, FAKE_USERNAME } from './helpers.js';

describe('redaction', () => {
  it('removes known secrets, apikey/password URL parameters, and Basic/Bearer values', () => {
    expect(redactText(`a ${FAKE_API_KEY} b`, [FAKE_API_KEY])).toBe(`a ${REDACTED} b`);
    expect(redactText('https://csv.webfleet.com/extern?account=a&apikey=abc123&action=x')).toBe(`https://csv.webfleet.com/extern?account=a&apikey=${REDACTED}&action=x`);
    expect(redactText('?username=u&password=hunter2&x=1')).toBe(`?username=u&password=${REDACTED}&x=1`);
    expect(redactText(`Authorization: ${basicOf(FAKE_USERNAME, FAKE_PASSWORD)}`)).toBe(`Authorization: ${REDACTED}`);
    expect(redactText('Authorization: Bearer abc.def-ghi')).toBe(`Authorization: ${REDACTED}`);
  });

  it('keeps fleet data such as object numbers, driver ids, and trip ids', () => {
    const rows = [{ objectno: '001', objectuid: 'uid-1', driverno: 'D7', tripid: 1000001, licenseplatenumber: 'AB-123-C' }];
    expect(JSON.parse(renderSafe(rows, 10_000))).toEqual(rows);
  });

  it('redacts string values under credential-named keys', () => {
    expect(redactValue({ apikey: 'k', authorization: 'Basic y', password: 'z', nested: [{ 'X-Webfleet-Password': 'p' }] })).toEqual({
      apikey: REDACTED,
      authorization: REDACTED,
      password: REDACTED,
      nested: [{ 'X-Webfleet-Password': REDACTED }],
    });
  });

  it('serializes tool output compactly', () => {
    expect(renderSafe([{ objectno: '001' }], 10_000)).toBe('[{"objectno":"001"}]');
  });

  it('caps upstream bodies at 4 MiB by default', () => {
    delete process.env.WEBFLEET_MAX_UPSTREAM_BYTES;
    expect(maxUpstreamBytes()).toBe(4 * 1024 * 1024);
  });

  it('redacts before truncating so a secret cannot survive as a prefix', () => {
    const out = renderSafe(`${'x'.repeat(10)}${FAKE_API_KEY}`, 30, [FAKE_API_KEY]);
    expect(out).not.toContain(FAKE_API_KEY.slice(0, 12));
  });
});

describe('oversized row lists', () => {
  const rows = Array.from({ length: 200 }, (_, i) => ({ objectno: String(i).padStart(3, '0'), objectname: `Vehicle ${i}`, pad: 'y'.repeat(50) }));

  it('keeps as many leading rows as fit and says how many were dropped', () => {
    const out = renderSafe(rows, 2000);
    expect(out.length).toBeLessThanOrEqual(2000);
    const body = JSON.parse(out);
    expect(body.truncated).toBe(true);
    expect(body.total_items).toBe(200);
    expect(body.returned_items).toBe(body.data.length);
    expect(body.returned_items).toBeGreaterThan(0);
    expect(body.data[0]).toEqual(rows[0]);
    expect(body.truncation_hint).toMatch(/columnfilter/);
  });

  it('falls back to text truncation for non-array output', () => {
    const out = renderSafe({ blob: 'z'.repeat(5000) }, 1000);
    expect(out).toMatch(/\[truncated: \d+ more characters omitted/);
  });
});
