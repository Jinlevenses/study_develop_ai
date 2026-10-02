// 암호 연산 포트 — 구현 = application/session/crypto.ts(node:crypto). domain은 순수하게 유지한다(Buffer·node:* 0).

export type SessionCrypto = {
  /** base64url(HMAC-SHA256(key, utf8(message))), 패딩 없음 43자. */
  macB64u(key: Uint8Array, message: string): string;
  /** 상수 시간 비교: 길이가 다르면 false(비교 없이), 같으면 timingSafeEqual(utf8). */
  equal(a: string, b: string): boolean;
  /** base64url(SHA-256(utf8(value))) — 부트스트랩 토큰 저장 키. */
  hashB64u(value: string): string;
};
