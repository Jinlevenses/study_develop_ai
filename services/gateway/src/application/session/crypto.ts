import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { SessionCrypto } from '../../domain/session/ports.js';

// SessionCrypto의 node:crypto 구현 — 암호 연산은 domain 밖에서만 한다(STD-SEC-21).

export const nodeSessionCrypto: SessionCrypto = {
  macB64u(key: Uint8Array, message: string): string {
    return createHmac('sha256', key).update(message, 'utf8').digest('base64url');
  },
  equal(a: string, b: string): boolean {
    const x = Buffer.from(a, 'utf8');
    const y = Buffer.from(b, 'utf8');
    return x.length === y.length && timingSafeEqual(x, y);
  },
  hashB64u(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('base64url');
  },
};

/** 기본 난수원(`GatewayDefinitionOptions.randomBytes` 미지정 시). */
export function nodeRandomBytes(n: number): Uint8Array {
  return randomBytes(n);
}

export function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}
