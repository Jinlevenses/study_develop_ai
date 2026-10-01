import { timingSafeEqual as nodeTimingSafeEqual } from 'node:crypto';
import type { CallerName } from '@fathom/contracts/common/ids';
import { ServiceName } from '@fathom/contracts/common/ids';
import type { Result } from '@fathom/shared-kernel/errors/errors';
import { err, ok } from '@fathom/shared-kernel/errors/errors';

// IF-01 §2.11 내부 서비스 행 — `Authorization: Bearer <64 hex>` 호출자 식별과 ACL(STD-SEC-20·23).

export type CallerTokens = Readonly<Partial<Record<ServiceName, string>>>; // BootstrapEnvelope.callers
export interface CallerAuth {
  identify(authorization: string | undefined): Result<ServiceName, { reason: 'missing' | 'malformed' | 'unknown' }>;
}

const BEARER_RE = /^Bearer ([0-9a-f]{64})$/;
const TOKEN_RE = /^[0-9a-f]{64}$/;

type Registered = { readonly service: ServiceName; readonly bytes: Buffer };

/**
 * 등록된 모든 토큰을 끝까지 `timingSafeEqual`로 비교한다(일치해도 조기 종료 0 — 일치 위치가 시간에 새지 않게).
 * 오류 결과·예외 메시지에는 토큰 문자열이 들어가지 않는다.
 */
export function createCallerAuth(
  callers: CallerTokens,
  deps?: { timingSafeEqual?: (a: Uint8Array, b: Uint8Array) => boolean },
): CallerAuth {
  const compare = deps?.timingSafeEqual ?? nodeTimingSafeEqual;
  const registered: Registered[] = [];
  for (const [service, token] of Object.entries(callers)) {
    if (token === undefined) {
      continue;
    }
    const name = ServiceName.safeParse(service);
    if (!name.success) {
      throw new Error(`invariant: unknown caller service ${service}`);
    }
    if (!TOKEN_RE.test(token)) {
      throw new Error(`invariant: caller token for ${service} must be 64 lowercase hex characters`);
    }
    registered.push({ service: name.data, bytes: Buffer.from(token, 'hex') });
  }
  return {
    identify(authorization: string | undefined): Result<ServiceName, { reason: 'missing' | 'malformed' | 'unknown' }> {
      if (authorization === undefined || authorization === '') {
        return err({ reason: 'missing' });
      }
      const match = BEARER_RE.exec(authorization);
      if (match === null) {
        return err({ reason: 'malformed' });
      }
      const presented = Buffer.from(match[1] ?? '', 'hex');
      let found: ServiceName | null = null;
      for (const entry of registered) {
        const equal = compare(presented, entry.bytes);
        if (equal && found === null) {
          found = entry.service;
        }
      }
      return found === null ? err({ reason: 'unknown' }) : ok(found);
    },
  };
}

/** 식별 실패 → 401 `AUTH-900`, 허용 목록 밖 호출자 → 403 `ACL-900`(IF-01 §2.6.2). */
export function checkInternalAccess(
  auth: CallerAuth,
  authorization: string | undefined,
  allowed: readonly CallerName[],
): Result<ServiceName, { status: 401 | 403; suffix: 'AUTH-900' | 'ACL-900' }> {
  const who = auth.identify(authorization);
  if (!who.ok) {
    return err({ status: 401, suffix: 'AUTH-900' });
  }
  if (!allowed.includes(who.value)) {
    return err({ status: 403, suffix: 'ACL-900' });
  }
  return ok(who.value);
}
