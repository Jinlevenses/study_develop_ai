import { describe, expect, it } from 'vitest';
import { monotonicClientTs, systemClock } from '../../../src/time/time.js';

describe('time', () => {
  it('UT-SK-032 monotonicClientTs는 last가 null이면 now를 쓴다 [FR-PRG-027]', () => {
    expect(monotonicClientTs(1000, null)).toBe(1000);
  });

  it('UT-SK-033 monotonicClientTs는 시계 역행·동일 시각에서 last+1을 쓴다 [FR-PRG-027]', () => {
    expect(monotonicClientTs(900, 1000)).toBe(1001); // 역행
    expect(monotonicClientTs(1000, 1000)).toBe(1001); // 동일
    expect(monotonicClientTs(1500, 1000)).toBe(1500); // 정상 진행
  });

  it('UT-SK-034 systemClock.now()는 현재 근처의 정수 epoch ms다 [FR-PRG-027]', () => {
    const before = Date.now();
    const now = systemClock.now();
    const after = Date.now();
    expect(Number.isInteger(now)).toBe(true);
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
  });
});
