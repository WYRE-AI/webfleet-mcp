/**
 * Every tool in this server is read-only, so `read` is the only tier. The
 * tier machinery is kept identical to the rest of the fleet so Conduit's
 * X-Conduit-Tool-Tiers contract behaves the same here.
 */
export type ToolTier = 'read';

export const ALL_TIERS: readonly ToolTier[] = ['read'];

export const DEFAULT_TIERS: readonly ToolTier[] = ['read'];

/** Env vars holding the connection for stdio and AUTH_MODE=env. Never read in gateway mode. */
export const CREDENTIAL_ENV = {
  account: 'WEBFLEET_ACCOUNT',
  username: 'WEBFLEET_USERNAME',
  password: 'WEBFLEET_PASSWORD',
  apiKey: 'WEBFLEET_API_KEY',
} as const;

/**
 * Parses WEBFLEET_TOOL_TIERS. Unset or blank means DEFAULT_TIERS. An
 * unknown value throws so a typo fails loudly at startup.
 */
export function parseToolTiers(raw: string | undefined): ReadonlySet<ToolTier> {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return new Set(DEFAULT_TIERS);
  const tiers = new Set<ToolTier>();
  for (const part of trimmed.split(',')) {
    const value = part.trim().toLowerCase();
    if (!value) continue;
    if (!(ALL_TIERS as readonly string[]).includes(value)) {
      throw new Error(`Invalid WEBFLEET_TOOL_TIERS entry "${value}". Allowed: ${ALL_TIERS.join(', ')}.`);
    }
    tiers.add(value as ToolTier);
  }
  if (tiers.size === 0) return new Set(DEFAULT_TIERS);
  return tiers;
}

function positiveInt(raw: string | undefined, fallback: number, max: number): number {
  const n = Number.parseInt((raw ?? '').trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

export const MAX_BODY_BYTES = 1024 * 1024;

/**
 * WEBFLEET.connect serialises requests per account/username and answers a
 * new one with error 8015 while an earlier one is still running, so an early
 * client-side abort only makes the next call fail. The reference recommends
 * a 300 s timeout; 60 s is the default here, 300 s the maximum.
 */
export function requestTimeoutMs(): number {
  return positiveInt(process.env.WEBFLEET_REQUEST_TIMEOUT_MS, 60_000, 300_000);
}

export function maxResponseChars(): number {
  return positiveInt(process.env.WEBFLEET_MAX_RESPONSE_CHARS, 60_000, 1_000_000);
}

/** Upper bound on any upstream response body, enforced while streaming and before parsing, redaction, or truncation. */
export function maxUpstreamBytes(): number {
  return positiveInt(process.env.WEBFLEET_MAX_UPSTREAM_BYTES, 4 * 1024 * 1024, 128 * 1024 * 1024);
}

export type AuthMode = 'gateway' | 'env';

/**
 * The single AUTH_MODE parser (trimmed, case-insensitive). Unset or blank is
 * `env`; anything else unknown throws. Every caller must go through this so
 * the startup check and the per-request credential path can never disagree.
 */
export function parseAuthMode(raw: string | undefined): AuthMode {
  const value = (raw ?? '').trim().toLowerCase() || 'env';
  if (value !== 'gateway' && value !== 'env') {
    throw new Error(`AUTH_MODE must be "gateway" or "env" (got "${(raw ?? '').trim()}").`);
  }
  return value;
}

let gatewayLocked = false;

/** Called once the HTTP server starts in gateway mode. Irreversible for the process lifetime. */
export function lockGatewayMode(): void {
  gatewayLocked = true;
}

/** Test-only. */
export function resetGatewayLock(): void {
  gatewayLocked = false;
}

/** Fails closed: an unparseable AUTH_MODE counts as gateway, so env credentials are never used by mistake. */
export function isGatewayMode(): boolean {
  if (gatewayLocked) return true;
  try {
    return parseAuthMode(process.env.AUTH_MODE) === 'gateway';
  } catch {
    return true;
  }
}

/** Header Conduit may send to narrow (never widen) the enabled tiers for one request. */
export const TOOL_TIERS_HEADER = 'x-conduit-tool-tiers';

/**
 * Intersects the configured tiers with a per-request tier header. Unknown or
 * not-configured entries are dropped, so the header can only remove tiers.
 * A present header that names no configured tier (including an empty one)
 * yields an empty set (no tools), not the configured default.
 */
export function narrowTiers(configured: ReadonlySet<ToolTier>, header: string | undefined): ReadonlySet<ToolTier> {
  if (header === undefined) return configured;
  const requested = new Set(
    header
      .split(',')
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean),
  );
  return new Set(ALL_TIERS.filter((t) => configured.has(t) && requested.has(t)));
}
