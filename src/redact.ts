/**
 * Output hygiene for anything returned to the model or written to logs.
 * Order matters: redact first, then truncate, so a secret straddling the
 * truncation boundary can never survive as a partial prefix.
 *
 * Credentials are caught by exact match (the password, API key, and Basic
 * Auth token in use), by key name in structured data, and by shape
 * (`apikey=`/`password=` in a URL, `Basic`/`Bearer` header values).
 */

export const REDACTED = '[REDACTED]';

/** Normalized (lower-case, no `_`/`-`) key names whose string values are credentials. */
const SENSITIVE_KEYS = new Set(['apikey', 'xwebfleetapikey', 'password', 'passwd', 'xwebfleetpassword', 'authorization', 'sessiontoken', 'secret', 'clientsecret']);

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase().replace(/[_-]/g, ''));
}

/** Recursively replaces string values under credential-named keys. Returns a new value; the input is not mutated. */
export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 64) return REDACTED;
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitiveKey(key) && typeof v === 'string' && v.length > 0 ? REDACTED : redactValue(v, depth + 1);
    }
    return out;
  }
  return value;
}

const TEXT_PATTERNS: Array<[RegExp, string]> = [
  [/\b(apikey|password|passwd|sessiontoken)=[^&\s"']+/gi, `$1=${REDACTED}`],
  [/\bBasic\s+[A-Za-z0-9+/]{4,}=*/g, REDACTED],
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, REDACTED],
];

/**
 * Pattern-based redaction plus exact removal of any secrets known for this
 * request, also in their JSON-escaped and URL-encoded forms (output is
 * redacted after JSON.stringify, and vendor errors may echo a query string).
 */
export function redactText(text: string, knownSecrets: readonly (string | undefined)[] = []): string {
  let out = text;
  const forms = knownSecrets.flatMap((s) => (s && s.length >= 4 ? [s, JSON.stringify(s).slice(1, -1), encodeURIComponent(s)] : []));
  for (const secret of forms.sort((a, b) => b.length - a.length)) out = out.split(secret).join(REDACTED);
  for (const [pattern, replacement] of TEXT_PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const omitted = text.length - maxChars;
  return `${text.slice(0, maxChars)}\n\n[truncated: ${omitted} more characters omitted. Narrow the request with filters, columnfilter, or a shorter date range.]`;
}

/**
 * WEBFLEET.connect returns a flat JSON array of rows. When it does not fit,
 * keep as many leading rows as fit and say how many were dropped. Webfleet
 * has no paging, so the hint points at filters and columnfilter instead.
 * Returns undefined when not even an empty list fits.
 */
function shrinkRows(rows: unknown[], maxChars: number, render: (v: unknown) => string): string | undefined {
  const total = rows.length;
  const build = (n: number) =>
    render({
      truncated: true,
      returned_items: n,
      total_items: total,
      truncation_hint: `Only the first ${n} of ${total} rows fit in the response. Narrow the request (object/driver/group filters, a shorter date range) or pass columnfilter to return fewer columns.`,
      data: rows.slice(0, n),
    });
  if (build(0).length > maxChars) return undefined;
  // Output length only grows with n, so binary-search the largest n that fits.
  let lo = 0;
  let hi = total - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (build(mid).length <= maxChars) lo = mid;
    else hi = mid - 1;
  }
  return build(lo);
}

/**
 * Serializes, redacts, then fits the cap. The single exit path for tool
 * output. Length is measured on the redacted text. An oversized row list is
 * shrunk structurally; anything else is cut as text.
 */
export function renderSafe(value: unknown, maxChars: number, knownSecrets: readonly (string | undefined)[] = []): string {
  if (typeof value === 'string') return truncate(redactText(value, knownSecrets), maxChars);
  const render = (v: unknown) => redactText(JSON.stringify(v) ?? 'null', knownSecrets);
  const redacted = redactValue(value);
  const text = render(redacted);
  if (text.length <= maxChars) return text;
  return (Array.isArray(redacted) && shrinkRows(redacted, maxChars, render)) || truncate(text, maxChars);
}
