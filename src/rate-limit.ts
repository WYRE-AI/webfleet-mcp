/**
 * Client-side protection for WEBFLEET.connect's request limits. Webfleet
 * blocks an action once its limit is exceeded and keeps blocking until no
 * request arrives for a whole window; repeated overload can get a client's
 * limits lowered or its access revoked. So this process:
 * - throttles every action per account and per API key (the reference does
 *   not say which one Webfleet counts, so both must stay under the limit),
 *   refusing locally instead of sending a request that would be rejected;
 * - serialises requests per account/username, as the reference requires
 *   (error 8015 otherwise);
 * - caches successful responses per exact credential set and request for one
 *   limit interval (window / limit), so a repeated identical call is answered
 *   locally instead of spending the budget.
 * State is per process. Every map key is a SHA-256 hash, so no credential is
 * held here in clear text.
 */
import { createHash } from 'node:crypto';

export const MAX_CACHE_ENTRY_CHARS = 1024 * 1024;
export const MAX_CACHE_TOTAL_CHARS = 16 * 1024 * 1024;

export function hashKey(...parts: string[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

const sent = new Map<string, number[]>();

/**
 * Records a request against every key if all of them are under `limit` in the
 * trailing window. Otherwise records nothing and returns the milliseconds
 * until the earliest key has room again.
 */
export function takeSlot(keys: readonly string[], limit: number, windowMs: number, now = Date.now()): number {
  let waitMs = 0;
  for (const key of keys) {
    const recent = (sent.get(key) ?? []).filter((t) => now - t < windowMs);
    sent.set(key, recent);
    if (recent.length >= limit) waitMs = Math.max(waitMs, recent[0] + windowMs - now);
  }
  if (waitMs > 0) return waitMs;
  for (const key of keys) sent.get(key)!.push(now);
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

/** Stores a response for ttlMs. Oversized bodies are not cached; the oldest entries go first when the total cap is reached. */
export function cacheSet(key: string, value: unknown, chars: number, ttlMs: number, now = Date.now()): void {
  if (chars > MAX_CACHE_ENTRY_CHARS || ttlMs <= 0) return;
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
export function resetRateLimits(): void {
  sent.clear();
  cache.clear();
  cachedChars = 0;
  chains.clear();
}
