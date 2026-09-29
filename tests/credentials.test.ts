import { afterEach, describe, expect, it } from 'vitest';
import { credentialsFromHeaders, credentialsStorage, getCredentials, parseCredentials } from '../src/credentials.js';
import { API_KEY, applyEnv, clearEnv, CREDS } from './helpers.js';

describe('credentials', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it('returns no credentials when the environment is empty', () => {
    clearEnv();
    expect(getCredentials()).toEqual({ credentials: null });
  });

  it('reads single-tenant credentials from the environment', () => {
    applyEnv();
    process.env.WEBFLEET_HOST = 'csv.telematics.tomtom.com';
    process.env.WEBFLEET_LANG = 'de';
    expect(getCredentials().credentials).toEqual({
      account: CREDS.account,
      apiKey: API_KEY,
      username: CREDS.username,
      password: CREDS.password,
      host: 'csv.telematics.tomtom.com',
      lang: 'de',
    });
  });

  it('rejects an apikey that is not 36 characters', () => {
    const result = parseCredentials({ ...CREDS, apiKey: 'too-short' });
    expect(result.credentials).toBeNull();
    expect(result.error).toMatch(/36/);
  });

  it('rejects an unknown host', () => {
    const result = parseCredentials({ ...CREDS, host: 'evil.example' });
    expect(result.credentials).toBeNull();
  });

  it('prefers AsyncLocalStorage over environment credentials', () => {
    applyEnv();
    const gateway = parseCredentials({
      account: 'gateway-account',
      apiKey: API_KEY,
      username: 'gateway-user',
      password: 'gateway-pass',
    });
    credentialsStorage.run({ credentials: gateway.credentials! }, () => {
      expect(getCredentials().credentials?.account).toBe('gateway-account');
      expect(getCredentials().credentials?.username).toBe('gateway-user');
    });
  });

  it('maps x-webfleet-* headers and rejects a partial set', () => {
    const full = credentialsFromHeaders({
      'x-webfleet-account': CREDS.account,
      'x-webfleet-api-key': API_KEY,
      'x-webfleet-username': CREDS.username,
      'x-webfleet-password': CREDS.password,
      'x-webfleet-host': 'csv.webfleet.com',
    });
    expect(full?.credentials?.account).toBe(CREDS.account);
    expect(full?.credentials?.password).toBe(CREDS.password);

    const partial = credentialsFromHeaders({ 'x-webfleet-account': CREDS.account });
    expect(partial?.credentials).toBeUndefined();
    expect(partial?.error).toMatch(/x-webfleet-/);

    expect(credentialsFromHeaders({})).toBeNull();
  });
});
