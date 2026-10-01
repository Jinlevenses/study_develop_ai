import { describe, expect, it } from 'vitest';
import { AppError, assertDefined, assertNever, err, ok } from '../../../src/errors/errors.js';
import type { ErrorCodeString } from '../../../src/errors/errors.js';

describe('errors', () => {
  it('UT-SK-020 ok·err가 판별 유니온을 만든다 [NFR-MAINT-002]', () => {
    // Arrange / Act
    const good = ok(42);
    const bad = err({ kind: 'x' });
    // Assert
    expect(good).toEqual({ ok: true, value: 42 });
    expect(bad).toEqual({ ok: false, error: { kind: 'x' } });
    expect(good.ok).toBe(true);
    expect(bad.ok).toBe(false);
  });

  it('UT-SK-021 assertNever는 도달 불가 메시지를 던진다 [NFR-MAINT-002]', () => {
    // Arrange
    const never = { kind: 'surprise' } as never;
    // Act / Assert
    expect(() => assertNever(never)).toThrow('unreachable: {"kind":"surprise"}');
  });

  it('UT-SK-022 assertDefined는 null·undefined를 던진다 [NFR-MAINT-002]', () => {
    expect(() => assertDefined(undefined, 'row exists')).toThrow('invariant: row exists');
    expect(() => assertDefined(null, 'row exists')).toThrow('invariant: row exists');
  });

  it('UT-SK-023 assertDefined는 0·빈 문자열·false를 통과시킨다 [NFR-MAINT-002]', () => {
    expect(assertDefined(0, 'r')).toBe(0);
    expect(assertDefined('', 'r')).toBe('');
    expect(assertDefined(false, 'r')).toBe(false);
  });

  it('UT-SK-024 AppError는 code·status·detail·extra를 보존한다 [NFR-MAINT-002]', () => {
    // Arrange
    const extra = { dependency: 'learning', retry_after_ms: 500 };
    // Act
    const e = new AppError('LR-DEP-001', 503, '잠시 후 다시 시도하세요', { extra });
    // Assert
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('AppError');
    expect(e.code).toBe('LR-DEP-001');
    expect(e.status).toBe(503);
    expect(e.detail).toBe('잠시 후 다시 시도하세요');
    expect(e.extra).toEqual(extra);
    expect(e.message).toBe('LR-DEP-001');
  });

  it('UT-SK-025 AppError는 cause를 보존하고 선택 필드는 undefined다 [NFR-MAINT-002]', () => {
    // Arrange
    const cause = new Error('boom');
    // Act
    const e = new AppError('CLI-INTERNAL-900', 500, undefined, { cause });
    // Assert
    expect(e.cause).toBe(cause);
    expect(e.detail).toBeUndefined();
    expect(e.extra).toBeUndefined();
  });

  it('UT-SK-026 AppError는 잘못된 code·status를 결함으로 던진다 [NFR-MAINT-002]', () => {
    const badCode = 'XX-VAL-001' as ErrorCodeString;
    const shortNumber = 'GW-VAL-1' as ErrorCodeString;
    expect(() => new AppError(badCode, 400)).toThrow(/^invariant:/);
    expect(() => new AppError(shortNumber, 400)).toThrow(/^invariant:/);
    expect(() => new AppError('GW-VAL-001', 399)).toThrow(/^invariant:/);
    expect(() => new AppError('GW-VAL-001', 600)).toThrow(/^invariant:/);
    expect(() => new AppError('GW-VAL-001', 400.5)).toThrow(/^invariant:/);
    expect(new AppError('OP-POLICY-123', 599).status).toBe(599);
  });
});
