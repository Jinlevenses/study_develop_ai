import { Ulid } from '@fathom/contracts/common/ids';
import { describe, expect, it } from 'vitest';
import { createUlidSequence, fixedUlid } from '../../../src/ids.js';

describe('testkit ids', () => {
  it('UT-TK-020 fixedUlid는 contracts Ulid를 통과하고 n에 따라 사전순으로 증가한다 [NFR-MAINT-009]', () => {
    // Arrange
    const values = [0, 1, 31, 32, 1000, 2 ** 32, 2 ** 40 - 1].map(fixedUlid);
    // Assert
    for (const value of values) {
      expect(Ulid.safeParse(value).success).toBe(true);
      expect(value).toHaveLength(26);
      expect(value.startsWith('01J0000000')).toBe(true);
    }
    expect([...values].sort()).toEqual(values);
    expect(fixedUlid(0)).toBe('01J00000000000000000000000');
    expect(fixedUlid(33)).toBe('01J00000000000000000000011');
    expect(fixedUlid(1)).not.toBe(fixedUlid(2));
  });

  it('UT-TK-021 fixedUlid는 범위 밖·비정수를 던진다 [NFR-MAINT-009]', () => {
    expect(() => fixedUlid(-1)).toThrow(RangeError);
    expect(() => fixedUlid(2 ** 40)).toThrow(RangeError);
    expect(() => fixedUlid(1.5)).toThrow(RangeError);
    expect(() => fixedUlid(Number.NaN)).toThrow(RangeError);
  });

  it('UT-TK-022 createUlidSequence는 start부터 1씩 증가하는 결정적 시퀀스다 [NFR-MAINT-009]', () => {
    // Arrange
    const first = createUlidSequence();
    const offset = createUlidSequence(10);
    // Act / Assert
    expect([first(), first(), first()]).toEqual([fixedUlid(0), fixedUlid(1), fixedUlid(2)]);
    expect(offset()).toBe(fixedUlid(10));
    expect(offset()).toBe(fixedUlid(11));
  });
});
