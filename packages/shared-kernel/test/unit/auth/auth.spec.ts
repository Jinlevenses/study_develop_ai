import { describe, expect, it } from 'vitest';
import { checkInternalAccess, createCallerAuth } from '../../../src/auth/auth.js';

const T_GW = 'a'.repeat(64);
const T_CT = 'b'.repeat(64);
const T_LR = 'c'.repeat(64);
const bearer = (t: string): string => `Bearer ${t}`;

describe('createCallerAuth', () => {
  it('UT-SK-008 비교 함수 호출 수 = 등록 토큰 수(일치 위치 무관), 401 AUTH-900·403 ACL-900 [NFR-SEC-003]', () => {
    // Arrange
    let calls = 0;
    const counting = (a: Uint8Array, b: Uint8Array): boolean => {
      calls += 1;
      return Buffer.compare(a, b) === 0;
    };
    const auth = createCallerAuth({ gateway: T_GW, content: T_CT, learning: T_LR }, { timingSafeEqual: counting });
    // Act / Assert: 첫 번째·중간·마지막·미일치 모두 3회 비교
    for (const [token, who] of [
      [T_GW, 'gateway'],
      [T_CT, 'content'],
      [T_LR, 'learning'],
    ] as const) {
      calls = 0;
      expect(auth.identify(bearer(token))).toEqual({ ok: true, value: who });
      expect(calls, who).toBe(3);
    }
    calls = 0;
    expect(auth.identify(bearer('d'.repeat(64)))).toEqual({ ok: false, error: { reason: 'unknown' } });
    expect(calls).toBe(3);

    // 실제 비교로 ACL: 허용 목록 밖 호출자 → 403
    const real = createCallerAuth({ gateway: T_GW, content: T_CT });
    expect(checkInternalAccess(real, bearer(T_GW), ['gateway', 'cli'])).toEqual({ ok: true, value: 'gateway' });
    expect(checkInternalAccess(real, bearer(T_CT), ['gateway'])).toEqual({
      ok: false,
      error: { status: 403, suffix: 'ACL-900' },
    });
    for (const header of [undefined, '', 'Basic abc', bearer('z'.repeat(64)), bearer('d'.repeat(64))]) {
      expect(checkInternalAccess(real, header, ['gateway', 'content']), String(header)).toEqual({
        ok: false,
        error: { status: 401, suffix: 'AUTH-900' },
      });
    }
  });

  it('UT-SK-100 missing·malformed·unknown을 구분한다 [NFR-SEC-003][IF-COM-004]', () => {
    const auth = createCallerAuth({ gateway: T_GW });
    expect(auth.identify(undefined)).toEqual({ ok: false, error: { reason: 'missing' } });
    expect(auth.identify('')).toEqual({ ok: false, error: { reason: 'missing' } });
    for (const bad of [
      'Bearer',
      'Bearer ',
      `bearer ${T_GW}`,
      `Bearer  ${T_GW}`,
      `Bearer ${T_GW} `,
      'Bearer abc',
      T_GW,
    ]) {
      expect(auth.identify(bad), bad).toEqual({ ok: false, error: { reason: 'malformed' } });
    }
    expect(auth.identify(bearer('e'.repeat(64)))).toEqual({ ok: false, error: { reason: 'unknown' } });
  });

  it('UT-SK-101 대문자 hex는 거부한다 [NFR-SEC-003]', () => {
    const auth = createCallerAuth({ gateway: T_GW });
    expect(auth.identify(bearer(T_GW.toUpperCase()))).toEqual({ ok: false, error: { reason: 'malformed' } });
    expect(() => createCallerAuth({ gateway: T_GW.toUpperCase() })).toThrow(/64 lowercase hex/);
    expect(() => createCallerAuth({ gateway: 'short' })).toThrow(/64 lowercase hex/);
  });

  it('UT-SK-102 callers가 비어 있으면 형식이 맞아도 unknown이고 비교 호출 0이다 [NFR-SEC-003]', () => {
    let calls = 0;
    const auth = createCallerAuth(
      {},
      {
        timingSafeEqual: () => {
          calls += 1;
          return true;
        },
      },
    );
    expect(auth.identify(bearer(T_GW))).toEqual({ ok: false, error: { reason: 'unknown' } });
    expect(calls).toBe(0);
    // undefined 값 항목은 등록하지 않는다.
    expect(createCallerAuth({ gateway: undefined }).identify(bearer(T_GW))).toEqual({
      ok: false,
      error: { reason: 'unknown' },
    });
  });

  it('UT-SK-103 알 수 없는 서비스 이름 키는 던진다 [NFR-SEC-003]', () => {
    const bad: Record<string, string> = { nobody: T_GW };
    expect(() => createCallerAuth(bad)).toThrow(/unknown caller service nobody/);
  });

  it('UT-SK-104 오류 결과·예외 메시지에 토큰 문자열이 없다 [NFR-SEC-003][IF-COM-004]', () => {
    const auth = createCallerAuth({ gateway: T_GW });
    const results = [
      auth.identify(bearer('9'.repeat(64))),
      auth.identify(`Bearer ${'9'.repeat(63)}`),
      auth.identify(undefined),
      checkInternalAccess(auth, bearer('9'.repeat(64)), ['gateway']),
    ];
    for (const r of results) {
      expect(JSON.stringify(r)).not.toContain('9'.repeat(8));
      expect(JSON.stringify(r)).not.toContain(T_GW);
    }
    let message = '';
    try {
      createCallerAuth({ gateway: `${'7'.repeat(63)}Z` });
    } catch (e) {
      message = e instanceof Error ? e.message : '';
    }
    expect(message).not.toContain('7777');
  });
});
