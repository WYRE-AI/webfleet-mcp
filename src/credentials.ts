import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';
import { ALLOWED_HOSTS, DEFAULT_HOST, type WebfleetHost } from './constants.js';

export interface WebfleetCredentials {
  account: string;
  /** Exactly 36 characters, sent as the apikey query parameter. */
  apiKey: string;
  /** HTTP Basic Auth user. Never placed in the query string. */
  username: string;
  /** HTTP Basic Auth password. Never placed in the query string. */
  password: string;
  host: WebfleetHost;
  lang: string;
}

export interface CredentialLookup {
  credentials: WebfleetCredentials | null;
  /** Set when credentials were supplied but failed validation. */
  error?: string;
}

interface CredentialStore {
  credentials?: WebfleetCredentials;
  error?: string;
}

export const credentialsStorage = new AsyncLocalStorage<CredentialStore>();

const credentialSchema = z.object({
  account: z.string().trim().min(1, 'account is required'),
  apiKey: z
    .string()
    .trim()
    .length(36, 'apikey must be exactly 36 characters'),
  username: z.string().min(1, 'username is required'),
  password: z.string().min(1, 'password is required'),
  host: z.enum(ALLOWED_HOSTS).optional(),
  lang: z
    .string()
    .regex(/^[a-z]{2}$/, 'lang must be a two-letter language code')
    .optional(),
});

export interface CredentialInput {
  account?: string;
  apiKey?: string;
  username?: string;
  password?: string;
  host?: string;
  lang?: string;
}

export function parseCredentials(input: CredentialInput): CredentialLookup {
  const parsed = credentialSchema.safeParse({
    account: input.account,
    apiKey: input.apiKey,
    username: input.username,
    password: input.password,
    host: input.host || undefined,
    lang: input.lang || undefined,
  });

  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => (issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
      .join('; ');
    return { credentials: null, error: message };
  }

  return {
    credentials: {
      account: parsed.data.account,
      apiKey: parsed.data.apiKey,
      username: parsed.data.username,
      password: parsed.data.password,
      host: parsed.data.host ?? DEFAULT_HOST,
      lang: parsed.data.lang ?? 'en',
    },
  };
}

function envInput(): CredentialInput {
  return {
    account: process.env.WEBFLEET_ACCOUNT,
    apiKey: process.env.WEBFLEET_API_KEY,
    username: process.env.WEBFLEET_USERNAME,
    password: process.env.WEBFLEET_PASSWORD,
    host: process.env.WEBFLEET_HOST,
    lang: process.env.WEBFLEET_LANG,
  };
}

export function loadEnvCredentials(): CredentialLookup {
  const input = envInput();
  const anySet = Boolean(input.account || input.apiKey || input.username || input.password || input.host);
  if (!anySet) {
    return { credentials: null };
  }
  return parseCredentials(input);
}

/**
 * Gateway headers win over environment variables for the current async context.
 * A partial header set is an error and does not fall back to env credentials.
 */
export function credentialsFromHeaders(
  headers: Record<string, string | string[] | undefined>,
): CredentialStore | null {
  const one = (name: string): string | undefined => {
    const value = headers[name];
    if (Array.isArray(value)) return value[0];
    return value;
  };

  const account = one('x-webfleet-account');
  const apiKey = one('x-webfleet-api-key');
  const username = one('x-webfleet-username');
  const password = one('x-webfleet-password');
  const host = one('x-webfleet-host');
  const lang = one('x-webfleet-lang');

  const supplied = [account, apiKey, username, password].filter((value) => value !== undefined && value !== '');
  if (supplied.length === 0 && !host && !lang) {
    return null;
  }

  if (supplied.length < 4) {
    return {
      error:
        'Incomplete x-webfleet-* headers. Gateway mode requires x-webfleet-account, x-webfleet-api-key (36 characters), x-webfleet-username, and x-webfleet-password.',
    };
  }

  const parsed = parseCredentials({ account, apiKey, username, password, host, lang });
  if (!parsed.credentials) {
    return { error: parsed.error };
  }
  return { credentials: parsed.credentials };
}

export function getCredentials(): CredentialLookup {
  const store = credentialsStorage.getStore();
  if (store) {
    if (store.credentials) return { credentials: store.credentials };
    return { credentials: null, error: store.error };
  }
  return loadEnvCredentials();
}
