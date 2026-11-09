/**
 * The only path to WEBFLEET.connect. The host is a compile-time constant
 * (never tenant-supplied), so there is no base-URL, host-allowlist, or DNS
 * layer; what remains is the request contract:
 * - GET only, to an allowlisted read action, with fixed headers;
 *   redirect: "manual" and every 3xx is an error;
 * - the URL is checked to stay on https://csv.webfleet.com/extern; username
 *   and password only travel in the Basic Auth header, never the URL;
 * - response bodies are bounded while streaming;
 * - vendor errors keep the HTTP status and the WEBFLEET.connect error code;
 * - per-account throttle, per-user serialisation, and a short response
 *   cache (rate-limit.ts) keep the account under Webfleet's request limits.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { ACTIONS, describeLimit, isAllowedAction, type Action } from './actions.js';
import { basicToken, validateCredentials } from './auth.js';
import { CREDENTIAL_ENV, isGatewayMode, maxUpstreamBytes, requestTimeoutMs } from './config.js';
import { cacheGet, cacheSet, hashKey, serialize, takeSlot } from './rate-limit.js';
import { ArgumentError, CredentialError, ThrottleError, WebfleetApiError, type WebfleetCredentials } from './types.js';
import { VERSION } from './version.js';

export const WEBFLEET_ORIGIN = 'https://csv.webfleet.com';
export const WEBFLEET_PATH = '/extern';

const credentialStore = new AsyncLocalStorage<WebfleetCredentials>();
const callerSignal = new AsyncLocalStorage<AbortSignal>();

/** Runs fn with per-request credentials (gateway mode: from the X-Webfleet-* headers). */
export function runWithCredentials<T>(creds: WebfleetCredentials, fn: () => T): T {
  return credentialStore.run(creds, fn);
}

function envCredentials(): Partial<WebfleetCredentials> {
  return {
    account: process.env[CREDENTIAL_ENV.account],
    username: process.env[CREDENTIAL_ENV.username],
    password: process.env[CREDENTIAL_ENV.password],
    apiKey: process.env[CREDENTIAL_ENV.apiKey],
  };
}

/** Per-request credentials if in scope; otherwise WEBFLEET_* env, except in gateway mode, which never reads env. */
export function resolveCredentials(): WebfleetCredentials {
  const scoped = credentialStore.getStore();
  if (scoped) return scoped;
  if (isGatewayMode()) {
    throw new CredentialError(
      'No WEBFLEET.connect credentials on this request. Gateway mode requires the X-Webfleet-Account, X-Webfleet-Username, X-Webfleet-Password, and X-Webfleet-Api-Key headers.',
    );
  }
  const env = envCredentials();
  const missing = (Object.keys(CREDENTIAL_ENV) as Array<keyof typeof CREDENTIAL_ENV>).filter((k) => !env[k]?.trim()).map((k) => CREDENTIAL_ENV[k]);
  if (missing.length) throw new CredentialError(`No WEBFLEET.connect credentials configured. Set ${missing.join(', ')}.`);
  return env as WebfleetCredentials;
}

/**
 * Every secret that could show up in output or logs for this request: the
 * password, the API key, and the Basic Auth token, for both the per-request
 * (gateway) credentials and the env credentials. Never throws.
 */
export function knownSecrets(): string[] {
  const out: string[] = [];
  for (const c of [credentialStore.getStore(), envCredentials()]) {
    if (!c) continue;
    const password = c.password;
    const apiKey = c.apiKey?.trim();
    if (password) out.push(password);
    if (apiKey) out.push(apiKey);
    if (c.username && password) out.push(basicToken({ username: c.username.trim(), password }));
  }
  return out;
}

/** Runs fn with the MCP request's cancellation signal, so upstream calls abort when the client cancels or disconnects. */
export function runWithAbortSignal<T>(signal: AbortSignal | undefined, fn: () => T): T {
  return signal ? callerSignal.run(signal, fn) : fn();
}

function requestSignal(): AbortSignal {
  const timeout = AbortSignal.timeout(requestTimeoutMs());
  const caller = callerSignal.getStore();
  return caller ? AbortSignal.any([timeout, caller]) : timeout;
}

export type QueryValue = string | number | boolean;

/** Set by this client on every request; a caller can never override them. Compared lower-case. */
const RESERVED_PARAMS = new Set(['account', 'apikey', 'action', 'lang', 'outputformat', 'useutf8', 'useiso8601', 'username', 'password', 'sessiontoken', 'separator']);

const PARAM_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/**
 * Builds the request URL: the fixed origin and path, the common parameters
 * in the reference's order, then the action's own parameters. Throws if the
 * action is not allowlisted, a parameter name is malformed or reserved, or
 * the result leaves https://csv.webfleet.com/extern.
 */
export function buildUrl(creds: Pick<WebfleetCredentials, 'account' | 'apiKey'>, action: string, params: Record<string, QueryValue | undefined> = {}): URL {
  if (!isAllowedAction(action)) throw new ArgumentError(`"${String(action).slice(0, 80)}" is not an allowed read-only WEBFLEET.connect action.`);
  const query = new URLSearchParams({
    lang: 'en',
    account: creds.account,
    apikey: creds.apiKey,
    action,
    outputformat: 'json',
    useUTF8: 'true',
    useISO8601: 'true',
  });
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (!PARAM_NAME.test(key)) throw new ArgumentError(`Invalid parameter name "${key.slice(0, 64)}".`);
    if (RESERVED_PARAMS.has(key.toLowerCase())) throw new ArgumentError(`Parameter "${key}" is set by the server and cannot be passed.`);
    query.append(key, String(value));
  }
  const url = new URL(`${WEBFLEET_PATH}?${query.toString()}`, WEBFLEET_ORIGIN);
  if (url.origin !== WEBFLEET_ORIGIN || url.pathname !== WEBFLEET_PATH) {
    throw new ArgumentError('Refusing to call a URL outside WEBFLEET.connect.');
  }
  return url;
}

/** WEBFLEET.connect "no data" response codes: an empty result, not a failure. */
const EMPTY_RESULT_CODES = new Set(['63', '9198']);

/**
 * Calls one read action and returns the parsed JSON (an array of flat rows).
 * Identical calls within the action's limit interval are answered from the
 * cache; a call that would exceed the limit is refused before it is sent.
 */
export async function webfleetGet(rawCreds: WebfleetCredentials, action: Action, params: Record<string, QueryValue | undefined> = {}): Promise<unknown> {
  const creds = validateCredentials(rawCreds);
  const url = buildUrl(creds, action, params);
  const { limit, windowMs } = ACTIONS[action];

  const cacheKey = hashKey(creds.account, creds.username, creds.password, creds.apiKey, url.search);
  const hit = cacheGet(cacheKey);
  if (hit) return hit.value;

  const userKey = hashKey('user', creds.account.toLowerCase(), creds.username.toLowerCase());
  return serialize(userKey, async () => {
    // A call queued behind an identical one is answered by its result.
    const queuedHit = cacheGet(cacheKey);
    if (queuedHit) return queuedHit.value;

    const waitMs = takeSlot([hashKey('account', creds.account.toLowerCase(), action), hashKey('apikey', creds.apiKey, action)], limit, windowMs);
    if (waitMs > 0) {
      const seconds = Math.ceil(waitMs / 1000);
      throw new ThrottleError(
        `Not sent: WEBFLEET.connect allows ${describeLimit(action)} for ${action}, and this account has used that budget. Retry in ${seconds}s. (Exceeding the limit makes Webfleet block the action and can get API access reduced.)`,
        seconds,
      );
    }

    const { value, chars } = await send(creds, action, url);
    cacheSet(cacheKey, value, chars, Math.floor(windowMs / limit));
    return value;
  });
}

async function send(creds: WebfleetCredentials, action: Action, url: URL): Promise<{ value: unknown; chars: number }> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: {
        authorization: `Basic ${basicToken(creds)}`,
        accept: 'application/json',
        'user-agent': `webfleet-mcp/${VERSION}`,
      },
      redirect: 'manual',
      signal: requestSignal(),
    });
  } catch (err) {
    const aborted = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    throw new WebfleetApiError(aborted ? `WEBFLEET.connect ${action} timed out or was cancelled.` : 'Could not reach WEBFLEET.connect (network error).');
  }

  if ((res.status >= 300 && res.status < 400) || res.type === 'opaqueredirect') {
    await res.body?.cancel().catch(() => undefined);
    throw new WebfleetApiError(`WEBFLEET.connect answered ${action} with a redirect (HTTP ${res.status}); refusing to follow it.`, res.status);
  }

  const text = (await readBoundedText(res, maxUpstreamBytes())).trim();
  const headerCode = res.headers.get('x-webfleet-errorcode')?.trim();
  const parsed = parseBody(text);
  const vendor = headerCode
    ? { code: headerCode, message: decodeHeader(res.headers.get('x-webfleet-errormessage')) || parsed.error?.message || '' }
    : parsed.error;

  if (vendor && EMPTY_RESULT_CODES.has(vendor.code)) return { value: [], chars: 2 };
  if (vendor || !res.ok) throw vendorError(action, res.status, vendor?.code, vendor?.message || text);
  if (!text) return { value: [], chars: 2 };
  if (!parsed.json) throw new WebfleetApiError(`WEBFLEET.connect returned a non-JSON body for ${action}.`, res.status);
  return { value: parsed.value, chars: text.length };
}

interface Parsed {
  json: boolean;
  value?: unknown;
  error?: { code: string; message: string };
}

/**
 * JSON rows, a JSON error object ({"errorCode": n, "errorMsg": "..."}), or
 * the plain-text error form "id, description" from the reference.
 */
function parseBody(text: string): Parsed {
  if (!text) return { json: false };
  try {
    const value = JSON.parse(text) as unknown;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const o = value as Record<string, unknown>;
      const code = o.errorCode ?? o.errorcode;
      if (typeof code === 'number' || (typeof code === 'string' && code.trim())) {
        const message = o.errorMsg ?? o.errorMessage ?? o.errormessage;
        return { json: true, value, error: { code: String(code).trim(), message: typeof message === 'string' ? message : '' } };
      }
    }
    return { json: true, value };
  } catch {
    const plain = /^(\d{1,6})\s*,\s*([\s\S]*)$/.exec(text);
    return plain ? { json: false, error: { code: plain[1], message: plain[2].trim() } } : { json: false };
  }
}

function decodeHeader(value: string | null): string {
  if (!value) return '';
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

const MAX_VENDOR_MESSAGE = 1000;

/** Hints for the response codes an operator can act on (reference: "Response codes"). */
function hintFor(status: number, code: string | undefined): string {
  if (code === '1101' || code === '1105' || code === '1106' || status === 401) {
    return ': the account, username, or password is wrong';
  }
  if (code === '8014' || code === '45' || status === 403) {
    return ': access denied; the API key must be valid and the user needs the WEBFLEET.connect access right';
  }
  if (code === '8011' || status === 429) {
    return ': request quota reached; Webfleet blocks this action until no request arrives for a full limit window, so wait before retrying';
  }
  if (code === '8015') return ': another request for this account and user is still running; wait at least 10 seconds before retrying';
  if (code === '55' || code === '8104') return ': action not available for this account';
  return '';
}

function vendorError(action: Action, status: number, code: string | undefined, message: string | undefined): WebfleetApiError {
  const parts = [
    `WEBFLEET.connect error for ${action} (HTTP ${status}${code ? `, code ${code}` : ''})${hintFor(status, code)}.`,
    message ? message.slice(0, MAX_VENDOR_MESSAGE) : undefined,
  ];
  return new WebfleetApiError(parts.filter(Boolean).join(' '), status, code);
}

/** Reads a response body as text, cancelling the stream as soon as it exceeds maxBytes. */
async function readBoundedText(res: Response, maxBytes: number): Promise<string> {
  const tooLarge = () =>
    new WebfleetApiError(`WEBFLEET.connect response exceeded ${maxBytes} bytes; narrow the request with filters, columnfilter, or a shorter date range.`);
  const declared = Number.parseInt(res.headers.get('content-length') ?? '', 10);
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw tooLarge();
  }
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
