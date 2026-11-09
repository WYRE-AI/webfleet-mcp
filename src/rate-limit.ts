/**
 * Client-side protection for WEBFLEET.connect's request limits. Webfleet
 * blocks an action once its limit is exceeded and keeps blocking until no
 * request arrives for a whole window; repeated overload can get a client's
 * limits lowered or its access revoked. So this process:
 * - throttles every action per tenant account and its API key, refusing
 *   locally instead of sending a request that would be rejected. A bucket is
 *   never shared across accounts (one partner API key can serve many
 *   tenants), and never keyed on the account name alone: a slot is spent
 *   before Webfleet checks credentials, so such a bucket would let anyone who
 *   guesses an account name lock its owner out;
 * - serialises requests per exact credential set, as the reference requires
 *   per account/username (error 8015 otherwise), and holds a credential set
 *   back for a while after a request timed out, since Webfleet may still be
 *   running it;
 * - caches successful responses per exact credential set and request for one
 *   limit interval (window / limit), so a repeated identical call is answered
 *   locally instead of spending the budget.
 * State is per process and bounded: expired throttle keys and holds are swept,
 * every map has a size cap, and every cache entry is charged a minimum size.
 * Every map key is a SHA-256 hash, so no credential is held here in clear text.
 */
import { createHash } from 'node:crypto';

export const MAX_CACHE_ENTRY_CHARS = 1024 * 1024;
export const MAX_CACHE_TOTAL_CHARS = 16 * 1024 * 1024;
/** Charged per cache entry whatever its body size, so tiny (empty) results cannot pile up. */
export const MIN_CACHE_ENTRY_CHARS = 1024;
export const MAX_SLOT_KEYS = 50_000;

export function hashKey(...parts: string[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

interface Slots {
  windowMs: number;
  times: number[];
}

/** Insertion order is last-use order: takeSlot re-inserts every key it records. */
const sent = new Map<string, Slots>();

/**
 * Records a request against every key if all of them are under `limit` in the
 * trailing window. Otherwise records nothing and returns the milliseconds
 * until the earliest key has room again.
 */
export function takeSlot(keys: readonly string[], limit: number, windowMs: number, now = Date.now()): number {
  sweepExpired(now);
  let waitMs = 0;
  const recent = keys.map((key) => {
    const times = (sent.get(key)?.times ?? []).filter((t) => now - t < windowMs);
    if (times.length >= limit) waitMs = Math.max(waitMs, times[0] + windowMs - now);
    return times;
  });
  if (waitMs > 0) return waitMs;
  keys.forEach((key, i) => {
    sent.delete(key);
    sent.set(key, { windowMs, times: [...recent[i], now] });
  });
  for (const oldest of sent.keys()) {
    if (sent.size <= MAX_SLOT_KEYS) break;
    sent.delete(oldest);
  }
  return 0;
}

interface CacheEntry {
  expires: number;
  value: unknown;
  chars: number;
}

const cache = new Map<string, CacheEntry>();
let cachedChars = 0;

function evict(key: string): void {
  const entry = cache.get(key);
  if (!entry) return;
  cachedChars -= entry.chars;
  cache.delete(key);
}

export function cacheGet(key: string, now = Date.now()): { value: unknown } | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expires <= now) {
    evict(key);
    return undefined;
  }
  return { value: entry.value };
}

/** Keys that must not send before a time (ms epoch). Insertion order is last-hold order. */
const holds = new Map<string, number>();

/** Holds key back for ms: heldFor(key) is positive until then. */
export function holdOff(key: string, ms: number, now = Date.now()): void {
  sweepExpired(now);
  holds.delete(key);
  holds.set(key, now + ms);
  for (const oldest of holds.keys()) {
    if (holds.size <= MAX_SLOT_KEYS) break;
    holds.delete(oldest);
  }
}

/** Milliseconds until key may send again (0: now). */
export function heldFor(key: string, now = Date.now()): number {
  const until = holds.get(key);
  if (until === undefined) return 0;
  if (until > now) return until - now;
  holds.delete(key);
  return 0;
}

const SWEEP_INTERVAL_MS = 60_000;
let lastSweep = 0;

/** At most once per interval, drops throttle keys whose window has passed, expired holds, and expired cache entries. */
function sweepExpired(now: number): void {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, s] of sent) if (now - s.times[s.times.length - 1] >= s.windowMs) sent.delete(key);
  for (const [key, until] of holds) if (until <= now) holds.delete(key);
  for (const [key, entry] of cache) if (entry.expires <= now) evict(key);
}

/** Stores a response for ttlMs. Oversized bodies are not cached; the oldest entries go first when the total cap is reached. */
export function cacheSet(key: string, value: unknown, bodyChars: number, ttlMs: number, now = Date.now()): void {
  if (bodyChars > MAX_CACHE_ENTRY_CHARS || ttlMs <= 0) return;
  const chars = Math.max(bodyChars, MIN_CACHE_ENTRY_CHARS);
  sweepExpired(now);
  evict(key);
  for (const oldest of cache.keys()) {
    if (cachedChars + chars <= MAX_CACHE_TOTAL_CHARS) break;
    evict(oldest);
  }
  cache.set(key, { expires: now + ttlMs, value, chars });
  cachedChars += chars;
}

const chains = new Map<string, Promise<unknown>>();

/** Runs fn after every earlier call with the same key has settled. */
export function serialize<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  const tail = run.catch(() => undefined);
  chains.set(key, tail);
  void tail.then(() => {
    if (chains.get(key) === tail) chains.delete(key);
  });
  return run;
}

/** Test-only. */
export function rateLimitSizes(): { slotKeys: number; cacheEntries: number } {
  return { slotKeys: sent.size, cacheEntries: cache.size };
}

/** Test-only. */
export function resetRateLimits(): void {
  sent.clear();
  holds.clear();
  lastSweep = 0;
  cache.clear();
  cachedChars = 0;
  chains.clear();
}
