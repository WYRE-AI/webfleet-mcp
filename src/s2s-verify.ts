/**
 * Verifies the conduit gateway's service-to-service auth header.
 * Ported from the WYRE MCP fleet (auvik-mcp / huntress-mcp). The secret is
 * opaque: an empty secret makes this return false, and the HTTP layer skips
 * the check when CONDUIT_S2S_SECRET is unset.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const S2S_HEADER = 'x-gateway-s2s';

const HEADER_VALUE_RE = /^t=(\d{1,15}),v1=([0-9a-f]{64})$/;

export function verifyS2sHeader(
  headerValue: string | undefined,
  secret: string,
  maxSkewSeconds = 300,
): boolean {
  if (!secret || !headerValue) return false;
  const match = HEADER_VALUE_RE.exec(headerValue);
  if (!match) return false;
  const t = Number(match[1]);
  if (!Number.isSafeInteger(t)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - t) > maxSkewSeconds) return false;
  const expected = createHmac('sha256', secret).update(`t=${t}`).digest();
  const provided = Buffer.from(match[2] ?? '', 'hex');
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
