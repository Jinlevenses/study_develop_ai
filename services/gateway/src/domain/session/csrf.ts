import type { SessionCrypto } from './ports.js';

// ADR-009 §2 — CSRF 토큰은 상태 없이 파생한다: base64url(HMAC-SHA256(key, 'csrf|' + sid)). 비교는 상수 시간(`SessionCrypto.equal`).

export function csrfToken(sid: string, key: Uint8Array, crypto: SessionCrypto): string {
  return crypto.macB64u(key, `csrf|${sid}`);
}

export function verifyCsrf(
  header: string | undefined,
  sid: string,
  key: Uint8Array,
  crypto: SessionCrypto,
): boolean {
  if (header === undefined || header === '') {
    return false;
  }
  return crypto.equal(header, csrfToken(sid, key, crypto));
}
