import type { IncomingHttpHeaders } from 'node:http';
import type { Clock } from '@fathom/shared-kernel/time/time';
import { COOKIE_NAME, readCookie, verifyCookie } from '../../domain/session/cookie.js';
import type { SessionCookie } from '../../domain/session/cookie.js';
import type { SessionCrypto } from '../../domain/session/ports.js';

// 이미 `publicAuth`를 통과한 요청의 쿠키를 다시 읽는다 — 요청 간 캐시는 두지 않는다.

export interface SessionReader {
  /** 통과한 요청에서만 부른다 — 실패는 결함(`invariant`). */
  read(headers: IncomingHttpHeaders): SessionCookie;
}

export function createSessionReader(d: {
  readonly key: Uint8Array;
  readonly crypto: SessionCrypto;
  readonly clock: Clock;
}): SessionReader {
  return {
    read(headers: IncomingHttpHeaders): SessionCookie {
      const verified = verifyCookie(
        readCookie(headers.cookie, COOKIE_NAME),
        d.key,
        d.crypto,
        Math.floor(d.clock.now() / 1000),
      );
      if (!verified.ok) {
        throw new Error(`invariant: session cookie rejected after publicAuth (${verified.error})`);
      }
      return verified.value;
    },
  };
}
