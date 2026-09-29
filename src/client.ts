import { API_PATH, READ_ACTION_PATTERN } from './constants.js';
import type { WebfleetCredentials } from './credentials.js';
import { WebfleetApiError } from './errors.js';

const FORBIDDEN_QUERY_KEYS = new Set(['username', 'password', 'user', 'passwd']);
const RESERVED_QUERY_KEYS = new Set(['account', 'apikey', 'action', 'outputformat', 'useutf8', 'useiso8601', 'lang']);

export interface WebfleetCall {
  action: string;
  params?: Record<string, string | number | boolean | undefined | null>;
}

export function assertReadAction(action: string): void {
  if (!READ_ACTION_PATTERN.test(action)) {
    throw new Error(
      `Action "${action}" is not a read operation. This server allows show*, get*, pop*, geocode*, calc*, and download* actions only.`,
    );
  }
}

export function buildRequestUrl(credentials: WebfleetCredentials, call: WebfleetCall): URL {
  assertReadAction(call.action);

  const url = new URL(`https://${credentials.host}${API_PATH}`);
  const query = url.searchParams;
  query.set('lang', credentials.lang);
  query.set('account', credentials.account);
  query.set('apikey', credentials.apiKey);
  query.set('action', call.action);
  query.set('outputformat', 'json');
  query.set('useUTF8', 'true');
  query.set('useISO8601', 'true');

  for (const [key, value] of Object.entries(call.params ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    const normalised = key.toLowerCase();
    if (FORBIDDEN_QUERY_KEYS.has(normalised)) {
      throw new Error(
        `Refusing to place "${key}" in the query string. Username and password authenticate with HTTP Basic Auth.`,
      );
    }
    if (RESERVED_QUERY_KEYS.has(normalised)) {
      throw new Error(`Parameter "${key}" is set by the client and cannot be overridden.`);
    }
    query.set(key, String(value));
  }

  if (query.has('username') || query.has('password')) {
    throw new Error('Username and password must not appear in the WEBFLEET.connect URL.');
  }

  return url;
}

export function basicAuthHeader(credentials: WebfleetCredentials): string {
  const token = Buffer.from(`${credentials.username}:${credentials.password}`, 'utf8').toString('base64');
  return `Basic ${token}`;
}

export async function parseWebfleetResponse(response: {
  ok: boolean;
  status: number;
  statusText: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}): Promise<unknown> {
  const errorCode = response.headers.get('x-webfleet-errorcode');
  const errorMessage = response.headers.get('x-webfleet-errormessage');
  const text = (await response.text()).trim();

  if (errorCode) {
    throw new WebfleetApiError(errorCode, decodeHeader(errorMessage) || text || response.statusText, response.status);
  }

  if (!text) {
    if (!response.ok) {
      throw new WebfleetApiError(String(response.status), response.statusText || 'request failed', response.status);
    }
    return [];
  }

  if (text.startsWith('[') || text.startsWith('{')) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      // Fall through to the plain-text error form.
    }
  }

  const plain = /^(\d+)\s*,\s*([\s\S]*)$/.exec(text);
  if (plain) {
    throw new WebfleetApiError(plain[1] ?? '0', (plain[2] ?? '').trim(), response.status);
  }

  if (!response.ok) {
    throw new WebfleetApiError(String(response.status), text || response.statusText, response.status);
  }

  return text;
}

function decodeHeader(value: string | null): string {
  if (!value) return '';
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

export class WebfleetClient {
  constructor(
    private readonly credentials: WebfleetCredentials,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async call(call: WebfleetCall): Promise<unknown> {
    const url = buildRequestUrl(this.credentials, call);
    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers: {
        Authorization: basicAuthHeader(this.credentials),
        Accept: 'application/json',
      },
    });
    return parseWebfleetResponse(response);
  }
}

export function createWebfleetClient(
  credentials: WebfleetCredentials,
  fetchImpl?: typeof fetch,
): WebfleetClient {
  return new WebfleetClient(credentials, fetchImpl);
}
