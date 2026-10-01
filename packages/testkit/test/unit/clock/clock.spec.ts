import { describe, expect, it } from 'vitest';
import { createFakeClock, FIXED_EPOCH_MS } from '../../../src/clock.js';

describe('createFakeClock', () => {
  it('UT-TK-006 기본 시작은 FIXED_EPOCH_MS이고 advance가 벽시계·단조 시계를 함께 진행한다 [NFR-MAINT-009]', () => {
    // Arrange
    const clock = createFakeClock();
    // Assert: 초기 상태
    expect(clock.now()).toBe(FIXED_EPOCH_MS);
    expect(clock.now()).toBe(FIXED_EPOCH_MS);
    expect(clock.monotonic()).toBe(0n);
    // Act
    clock.advance(250);
    // Assert
    expect(clock.now()).toBe(FIXED_EPOCH_MS + 250);
    expect(clock.monotonic()).toBe(250_000_000n);
    expect(createFakeClock(5).now()).toBe(5);
  });

  it('UT-TK-007 set은 벽시계만 되돌리고 잘못된 입력은 RangeError다 [NFR-MAINT-009]', () => {
    // Arrange
    const clock = createFakeClock();
    clock.advance(10);
    const before = clock.monotonic();
    // Act
    clock.set(FIXED_EPOCH_MS - 1000);
    // Assert
    expect(clock.now()).toBe(FIXED_EPOCH_MS - 1000);
    expect(clock.monotonic()).toBe(before);
    expect(() => {
      clock.advance(-1);
    }).toThrow(RangeError);
    expect(() => {
      clock.advance(1.5);
    }).toThrow(RangeError);
    expect(() => {
      clock.set(Number.NaN);
    }).toThrow(RangeError);
    expect(() => createFakeClock(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });
});
