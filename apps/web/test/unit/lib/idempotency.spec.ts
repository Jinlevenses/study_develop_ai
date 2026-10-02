import { describe, expect, it } from 'vitest';
import { createUlidFactory, IDEMPOTENCY_HEADER, newUlid } from '../../../src/lib/idempotency.js';

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

describe('idempotency', () => {
  it('UT-WEB-010 newUlid는 26자·시각 10자 인코딩·같은 ms 단조 증가·음수 시각은 RangeError다 [STD-TS-21]', () => {
    const zeros = (b: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> => b.fill(0);
    expect(IDEMPOTENCY_HEADER).toBe('idempotency-key');
    const id = newUlid(() => 1_790_000_000_000, zeros);
    expect(id).toMatch(ULID_RE);
    expect(id.slice(0, 10)).toBe('01M3250V00');
    // 앞 10자 = 48비트 시각의 Crockford base32(고정 값 대조)
    expect(newUlid(() => 0, zeros)).toBe('0'.repeat(26));
    expect(newUlid(() => 31, zeros).slice(0, 10)).toBe('000000000Z');
    expect(newUlid(() => 32, zeros).slice(0, 10)).toBe('0000000010');
    expect(newUlid(() => 2 ** 48 - 1, zeros).slice(0, 10)).toBe('7ZZZZZZZZZ');

    const make = createUlidFactory(() => 1_790_000_000_000, zeros);
    const first = make();
    const second = make();
    const third = make();
    expect(second > first).toBe(true);
    expect(third > second).toBe(true);
    expect(first.slice(0, 10)).toBe(second.slice(0, 10));
    expect(second.slice(10)).toBe('0000000000000001');

    const carry = createUlidFactory(
      () => 5,
      (b) => b.fill(255),
    );
    carry();
    expect(() => carry()).toThrow(RangeError);

    expect(() => newUlid(() => -1, zeros)).toThrow(RangeError);
    expect(() => newUlid(() => 1.5, zeros)).toThrow(RangeError);
    expect(() => newUlid(() => 2 ** 48, zeros)).toThrow(RangeError);
    // 기본 난수(Web Crypto)
    expect(newUlid(() => 1_790_000_000_000)).toMatch(ULID_RE);
  });
});
