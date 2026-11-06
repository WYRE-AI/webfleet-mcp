export const API_KEY = '0123456789abcdef0123456789abcdef0123';

export const CREDS = {
  account: 'wfcdevaccount',
  apiKey: API_KEY,
  username: 'wfcuser',
  password: 'yourpwd',
};

export function applyEnv(): void {
  process.env.WEBFLEET_ACCOUNT = CREDS.account;
  process.env.WEBFLEET_API_KEY = CREDS.apiKey;
  process.env.WEBFLEET_USERNAME = CREDS.username;
  process.env.WEBFLEET_PASSWORD = CREDS.password;
  delete process.env.WEBFLEET_HOST;
  delete process.env.WEBFLEET_LANG;
}

export function clearEnv(): void {
  delete process.env.WEBFLEET_ACCOUNT;
  delete process.env.WEBFLEET_API_KEY;
  delete process.env.WEBFLEET_USERNAME;
  delete process.env.WEBFLEET_PASSWORD;
  delete process.env.WEBFLEET_HOST;
  delete process.env.WEBFLEET_LANG;
}

export function mockJson(body: unknown, init?: { status?: number; headers?: Record<string, string> }): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status: init?.status ?? 200,
      headers: { 'content-type': 'application/json', ...init?.headers },
    })) as typeof fetch;
}
