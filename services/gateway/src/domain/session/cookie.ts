import type { Result } from '@fathom/shared-kernel/errors/errors';
import { err, ok } from '@fathom/shared-kernel/errors/errors';
import type { SessionCrypto } from './ports.js';

// ADR-009 §1 세션 쿠키 — `fathom_sid=v1.<sid>.<port>.<iat>.<mac>` (HttpOnly · SameSite=Strict · Path=/ · Max-Age 400일).

export const COOKIE_NAME = 'fathom_sid';
export type SessionCookie = { readonly sid: string; readonly port: number; readonly iat: number }; // iat = epoch 초

const COOKIE_RE = /^v1\.([A-Za-z0-9_-]{22})\.([1-9]\d{0,4})\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/;
/** 한도의 정본 — `constants.ts`의 `GATEWAY_LIMITS`가 이 값을 가져다 쓴다(복제 금지). */
export const COOKIE_MAX_AGE_S = 34_560_000;
export const COOKIE_FUTURE_SKEW_S = 300;
export const COOKIE_ROLL_AFTER_S = 86_400;
const MAX_PORT = 65_535;

/** `Cookie` 헤더(`; ` 구분)에서 첫 `name=` 값을 돌려준다(디코드 없음). */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) {
    return undefined;
  }
  const prefix = `${name}=`;
  for (const part of header.split('; ')) {
    if (part.startsWith(prefix)) {
      return part.slice(prefix.length);
    }
  }
  return undefined;
}

function messageOf(c: SessionCookie): string {
  return `v1|${c.sid}|${c.port}|${c.iat}`;
}

export function signCookie(c: SessionCookie, key: Uint8Array, crypto: SessionCrypto): string {
  return `v1.${c.sid}.${c.port}.${c.iat}.${crypto.macB64u(key, messageOf(c))}`;
}

export function verifyCookie(
  value: string | undefined,
  key: Uint8Array,
  crypto: SessionCrypto,
  nowS: number,
): Result<SessionCookie, 'missing' | 'malformed' | 'bad_mac' | 'expired'> {
  if (value === undefined || value === '') {
    return err('missing');
  }
  const m = COOKIE_RE.exec(value);
  const [, sid, portText, iatText, mac] = m ?? [];
  if (sid === undefined || portText === undefined || iatText === undefined || mac === undefined) {
    return err('malformed');
  }
  const cookie: SessionCookie = { sid, port: Number(portText), iat: Number(iatText) };
  if (cookie.port > MAX_PORT) {
    return err('malformed');
  }
  if (!crypto.equal(mac, crypto.macB64u(key, messageOf(cookie)))) {
    return err('bad_mac');
  }
  if (cookie.iat > nowS + COOKIE_FUTURE_SKEW_S || nowS - cookie.iat > COOKIE_MAX_AGE_S) {
    return err('expired');
  }
  return ok(cookie);
}

export function setCookieHeader(value: string): string {
  return `${COOKIE_NAME}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${COOKIE_MAX_AGE_S}`;
}

export function clearCookieHeader(): string {
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}

/** 사용 시 하루 1회 갱신 — `iat`가 24시간 이상 지났으면 true. */
export function needsRoll(c: SessionCookie, nowS: number): boolean {
  return nowS - c.iat >= COOKIE_ROLL_AFTER_S;
}
