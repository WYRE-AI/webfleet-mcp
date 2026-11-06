import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyS2sHeader } from '../src/s2s-verify.js';

function mintHeader(secret: string, unixSeconds: number): string {
  const message = `t=${unixSeconds}`;
  const hex = createHmac('sha256', secret).update(message).digest('hex');
  return `${message},v1=${hex}`;
}

describe('verifyS2sHeader', () => {
  const secret = 'webfleet-derived-subkey';

  it('accepts a fresh header and rejects a stale, empty, or tampered one', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(verifyS2sHeader(mintHeader(secret, now), secret)).toBe(true);
    expect(verifyS2sHeader(mintHeader(secret, now - 301), secret)).toBe(false);
    expect(verifyS2sHeader(undefined, secret)).toBe(false);
    expect(verifyS2sHeader(mintHeader(secret, now), '')).toBe(false);
    const header = mintHeader(secret, now);
    const tampered = header.slice(0, -1) + (header.endsWith('0') ? '1' : '0');
    expect(verifyS2sHeader(tampered, secret)).toBe(false);
  });
});
