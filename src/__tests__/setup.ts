import { beforeEach } from 'vitest';
import { resetRateLimits } from '../rate-limit.js';

// Never let a developer's real credentials or mode leak into the suite.
for (const key of [
  'WEBFLEET_ACCOUNT',
  'WEBFLEET_USERNAME',
  'WEBFLEET_PASSWORD',
  'WEBFLEET_API_KEY',
  'AUTH_MODE',
  'WEBFLEET_TOOL_TIERS',
  'CONDUIT_S2S_SECRET',
]) {
  delete process.env[key];
}

// Throttle, cache, and serialisation state is per process; every test starts clean.
beforeEach(() => resetRateLimits());
