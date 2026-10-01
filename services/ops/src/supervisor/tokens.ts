import type { ServiceName } from '@fathom/contracts/common/ids';

// ADR-012 §3 · NFR-SEC-003 — 호출자 토큰 5개는 supervisor 메모리에서만 생성·보관하고 봉투로만 전달한다.
export type RandomBytes = (n: number) => Uint8Array;

const SERVICE_NAMES: readonly ServiceName[] = ['gateway', 'content', 'learning', 'ai-gateway', 'ops-api'];

export function createCallerTokens(randomBytes: RandomBytes): Record<ServiceName, string> {
  const out: Partial<Record<ServiceName, string>> = {};
  for (const svc of SERVICE_NAMES) {
    out[svc] = Buffer.from(randomBytes(32)).toString('hex');
  }
  return out as Record<ServiceName, string>;
}

/** `run/cli.token` 값: 256bit base64url(43자). */
export function createCliToken(randomBytes: RandomBytes): string {
  return Buffer.from(randomBytes(32)).toString('base64url');
}
