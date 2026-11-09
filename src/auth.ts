import { CredentialError, type WebfleetCredentials } from './types.js';

export const API_KEY_LENGTH = 36;

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

function field(value: unknown, name: string, max: number, trim = true): string {
  if (typeof value !== 'string') throw new CredentialError(`The WEBFLEET.connect ${name} is missing.`);
  const s = trim ? value.trim() : value;
  if (!s) throw new CredentialError(`The WEBFLEET.connect ${name} is missing.`);
  if (s.length > max || CONTROL.test(s)) throw new CredentialError(`The WEBFLEET.connect ${name} is invalid.`);
  return s;
}

/**
 * Validates one connection before any request. The API key must be exactly
 * 36 visible ASCII characters (reference: "Authentication parameters"). A
 * username may not contain ":" because HTTP Basic Auth (RFC 7617) splits on
 * it. Control characters are refused everywhere so nothing can inject a
 * header line. No message here ever includes a credential value.
 */
export function validateCredentials(creds: Partial<WebfleetCredentials>): WebfleetCredentials {
  const account = field(creds.account, 'account', 256);
  const username = field(creds.username, 'username', 256);
  if (username.includes(':')) throw new CredentialError('The WEBFLEET.connect username is invalid: it may not contain ":".');
  const password = field(creds.password, 'password', 1024, false);
  const apiKey = field(creds.apiKey, 'API key', API_KEY_LENGTH + 1);
  if (!/^[\x21-\x7e]+$/.test(apiKey) || apiKey.length !== API_KEY_LENGTH) {
    throw new CredentialError(`The WEBFLEET.connect API key is invalid: it must be exactly ${API_KEY_LENGTH} characters.`);
  }
  return { account, username, password, apiKey };
}

/** The Basic Auth token (base64 of "username:password"), also redacted wherever it could appear. */
export function basicToken(creds: Pick<WebfleetCredentials, 'username' | 'password'>): string {
  return Buffer.from(`${creds.username}:${creds.password}`, 'utf8').toString('base64');
}
