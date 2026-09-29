import { describe, expect, it, vi } from 'vitest';
import { basicAuthHeader, buildRequestUrl, createWebfleetClient, parseWebfleetResponse } from '../src/client.js';
import { parseCredentials } from '../src/credentials.js';
import { WebfleetApiError } from '../src/errors.js';
import { CREDS } from './helpers.js';

function creds() {
  const parsed = parseCredentials(CREDS);
  if (!parsed.credentials) throw new Error(parsed.error);
  return parsed.credentials;
}

describe('WEBFLEET.connect client', () => {
  it('matches the documented Basic Auth example', () => {
    expect(basicAuthHeader(creds())).toBe('Basic d2ZjdXNlcjp5b3VycHdk');
  });

  it('puts account and apikey on the query string and keeps the password out of the URL', () => {
    const url = buildRequestUrl(creds(), {
      action: 'showObjectReportExtern',
      params: { filterstring: 'Demo' },
    });

    expect(url.origin).toBe('https://csv.webfleet.com');
    expect(url.pathname).toBe('/extern');
    expect(url.searchParams.get('account')).toBe(CREDS.account);
    expect(url.searchParams.get('apikey')).toBe(CREDS.apiKey);
    expect(url.searchParams.get('action')).toBe('showObjectReportExtern');
    expect(url.searchParams.get('outputformat')).toBe('json');
    expect(url.searchParams.get('useUTF8')).toBe('true');
    expect(url.searchParams.get('useISO8601')).toBe('true');
    expect(url.searchParams.get('lang')).toBe('en');
    expect(url.searchParams.get('filterstring')).toBe('Demo');
    expect(url.searchParams.has('username')).toBe(false);
    expect(url.searchParams.has('password')).toBe(false);
    expect(url.toString()).not.toContain(CREDS.password);
    expect(url.toString()).not.toContain(CREDS.username);
  });

  it('refuses username or password query parameters and write actions', () => {
    expect(() =>
      buildRequestUrl(creds(), { action: 'showObjectGroups', params: { password: 'secret' } }),
    ).toThrow(/Basic Auth/);
    expect(() => buildRequestUrl(creds(), { action: 'updateVehicle' })).toThrow(/read operation/);
    expect(() => buildRequestUrl(creds(), { action: 'deleteUser' })).toThrow(/read operation/);
    expect(() => buildRequestUrl(creds(), { action: '../etc/passwd' })).toThrow(/read operation/);
  });

  it('sends GET with Basic Auth and parses a JSON array', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(init?.method).toBe('GET');
      expect((init?.headers as Record<string, string>).Authorization).toBe('Basic d2ZjdXNlcjp5b3VycHdk');
      expect(url.searchParams.get('action')).toBe('showVehicleReportExtern');
      expect(url.searchParams.has('password')).toBe(false);
      return new Response(JSON.stringify([{ objectno: '001', objectname: 'Van' }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const rows = await createWebfleetClient(creds(), fetchImpl as unknown as typeof fetch).call({
      action: 'showVehicleReportExtern',
    });
    expect(rows).toEqual([{ objectno: '001', objectname: 'Van' }]);
  });

  it('turns the plain-text error form into WebfleetApiError', async () => {
    await expect(
      parseWebfleetResponse(
        new Response('63,document is empty', {
          status: 200,
          headers: { 'x-webfleet-errorcode': '63', 'x-webfleet-errormessage': 'document is empty' },
        }),
      ),
    ).rejects.toBeInstanceOf(WebfleetApiError);
  });
});
