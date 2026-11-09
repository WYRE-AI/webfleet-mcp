import { vi } from 'vitest';
import type { CallToolResult } from '../tools/types.js';
import type { WebfleetCredentials } from '../types.js';

/**
 * Every fake credential used by the test suite lives here. .gitleaks.toml
 * allowlists these exact strings and nothing broader.
 */
export const FAKE_ACCOUNT = 'wfc-test-account';
export const FAKE_USERNAME = 'wfc-test-user';
export const FAKE_PASSWORD = 'test-password-not-real-7Kq2';
/** Exactly 36 characters, like a real WEBFLEET.connect API key. */
export const FAKE_API_KEY = 'test-apikey-not-real-0000-000000000a';
export const FAKE_ENV_PASSWORD = 'env-password-must-not-be-used';
export const FAKE_ENV_API_KEY = 'env-apikey-must-not-be-used-00000000';
export const FAKE_S2S_SECRET = 'test-s2s-7Hq2Lw9Zr4Kx8Mv3Nb6Pc1Td5Fg0Yj';

export const CREDS: WebfleetCredentials = { account: FAKE_ACCOUNT, username: FAKE_USERNAME, password: FAKE_PASSWORD, apiKey: FAKE_API_KEY };

export const basicOf = (username: string, password: string) => `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

export function setEnvCredentials(creds: Partial<WebfleetCredentials> = CREDS): void {
  const map = { account: 'WEBFLEET_ACCOUNT', username: 'WEBFLEET_USERNAME', password: 'WEBFLEET_PASSWORD', apiKey: 'WEBFLEET_API_KEY' } as const;
  for (const [k, env] of Object.entries(map)) {
    const v = creds[k as keyof WebfleetCredentials];
    if (v === undefined) delete process.env[env];
    else process.env[env] = v;
  }
}

export function clearEnvCredentials(): void {
  for (const k of ['WEBFLEET_ACCOUNT', 'WEBFLEET_USERNAME', 'WEBFLEET_PASSWORD', 'WEBFLEET_API_KEY', 'AUTH_MODE']) delete process.env[k];
}

export function textOf(result: CallToolResult): string {
  const block = result.content?.[0];
  if (!block || block.type !== 'text') throw new Error(`Expected text content, got ${JSON.stringify(block)}`);
  return block.text;
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json;charset=UTF-8', ...headers } });
}

/** WEBFLEET.connect's documented error form: the code in X-Webfleet-Errorcode/-Errormessage and "id, description" as the body. */
export function webfleetError(code: string, message: string, status = 200): Response {
  return new Response(`${code}, ${message}`, {
    status,
    headers: { 'content-type': 'text/plain', 'x-webfleet-errorcode': code, 'x-webfleet-errormessage': encodeURIComponent(message) },
  });
}

export interface RecordedCall {
  method: string;
  url: URL;
  headers: Record<string, string>;
  redirect: RequestRedirect | undefined;
}

export type Route = (call: RecordedCall) => Response | undefined | Promise<Response | undefined>;

/**
 * Stubs globalThis.fetch as WEBFLEET.connect. Unmatched requests answer 599
 * so a wrong request fails the test loudly instead of looking like a vendor error.
 */
export function mockWebfleet(routes: Route[] = []) {
  const calls: RecordedCall[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const call: RecordedCall = { method: init?.method ?? 'GET', url, headers, redirect: init?.redirect };
    calls.push(call);
    for (const route of routes) {
      const response = await route(call);
      if (response) return response;
    }
    return new Response(`unmatched ${call.method} ${url.pathname}`, { status: 599 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

/** Answers every request with the given response factory. */
export function always(respond: (call: RecordedCall) => Response): Route {
  return (call) => respond(call);
}

/** The action's own parameters, i.e. the query without the fixed common parameters. */
export function actionParams(url: URL): Array<[string, string]> {
  const common = new Set(['lang', 'account', 'apikey', 'action', 'outputformat', 'useUTF8', 'useISO8601']);
  return [...url.searchParams.entries()].filter(([k]) => !common.has(k));
}
