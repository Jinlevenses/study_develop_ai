import { describe, expect, it } from 'vitest';
import { createPrng, mulberry32 } from '../../../src/prng.js';

describe('mulberry32', () => {
  it('UT-TK-008 시드 42·1의 기준값과 재현성, 비정수 시드 RangeError [NFR-MAINT-009]', () => {
    // Arrange
    const rng = mulberry32(42);
    // Act·Assert
    expect(rng()).toBe(0.6011037519201636);
    expect(rng()).toBe(0.44829055899754167);
    expect(rng()).toBe(0.8524657934904099);
    // Arrange: 같은 시드 두 개
    const a = mulberry32(42);
    const b = mulberry32(42);
    // Assert: 재현성
    for (let i = 0; i < 100; i++) {
      expect(a()).toBe(b());
    }
    expect(mulberry32(1)()).toBe(0.6270739405881613);
    expect(() => mulberry32(1.5)).toThrow(RangeError);
  });
});

describe('createPrng', () => {
  it('UT-TK-009 int·shuffle·pick 기준값과 오류, 분리한 next [NFR-MAINT-009]', () => {
    // Arrange
    const p42 = createPrng(42);
    // Act·Assert: int 기준값
    expect([1, 2, 3, 4, 5].map(() => p42.int(1, 6))).toEqual([4, 3, 6, 5, 2]);

    // Act·Assert: shuffle·pick 기준값, 입력 불변
    const input = [1, 2, 3, 4, 5];
    expect(createPrng(7).shuffle(input)).toEqual([4, 2, 3, 5, 1]);
    expect(input).toEqual([1, 2, 3, 4, 5]);

    expect(createPrng(7).pick(['a', 'b', 'c', 'd'])).toBe('a');

    // Assert: 잘못된 입력
    const prng = createPrng(1);
    expect(() => prng.int(3, 1)).toThrow(RangeError);
    expect(() => prng.int(1.5, 3)).toThrow(RangeError);
    expect(() => prng.pick([])).toThrow(RangeError);

    // Act: 분리한 next
    const detached = createPrng(9).next;
    const value = detached();
    // Assert
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(1);
  });
});
