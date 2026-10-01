import { describe, expect, it } from 'vitest';
import { contrastRatio, oklchToLinearSrgb, parseOklch, relativeLuminance, toHex } from '../../../src/color.js';

describe('color.ts', () => {
  it('UT-TOK-002 OKLCH 대비·hex 오라클(T1 실측)과 파싱·오류를 검증한다 [NFR-UX-001]', () => {
    const contrast: [string, string, number][] = [
      ['oklch(0.955 0.008 230)', 'oklch(0.20 0.02 245)', 15.88],
      ['oklch(0.67 0.02 240)', 'oklch(0.30 0.026 245)', 4.56],
      ['oklch(0.56 0.028 245)', 'oklch(0.26 0.024 245)', 3.35],
      ['oklch(0.23 0.03 250)', 'oklch(1 0 0)', 16.87],
      ['oklch(0.52 0.025 245)', 'oklch(0.935 0.009 232)', 4.54],
      ['oklch(1 0 0)', 'oklch(0.55 0.09 185)', 4.63],
    ];
    for (const [a, b, want] of contrast) {
      expect(Math.abs(contrastRatio(a, b) - want)).toBeLessThanOrEqual(0.01);
    }
    expect(Math.abs(contrastRatio('oklch(0.64 0.016 235)', 'oklch(0.962 0.007 230)') - 3.01)).toBeLessThanOrEqual(0.01);

    const hex: [string, string][] = [
      ['oklch(0.20 0.02 245)', '#0e171f'],
      ['oklch(0.955 0.008 230)', '#ebf1f4'],
      ['oklch(0.74 0.125 222)', '#32bce3'],
      ['oklch(0.67 0.02 240)', '#8b97a1'],
      ['oklch(0.55 0.09 185)', '#1b8278'],
      ['oklch(0.58 0.12 65)', '#aa691b'],
    ];
    for (const [v, want] of hex) {
      expect(toHex(v)).toBe(want);
    }

    expect(parseOklch('oklch(0.12 0.02 245 / 0.62)')).toEqual({ l: 0.12, c: 0.02, h: 245, alpha: 0.62 });
    expect(parseOklch('oklch(1 0 0)')).toEqual({ l: 1, c: 0, h: 0, alpha: 1 });
    expect(() => parseOklch('#fff')).toThrow(TypeError);
    expect(() => parseOklch('oklch(0.2 0.02)')).toThrow(TypeError);
    expect(toHex('oklch(0.12 0.02 245 / 0.62)')).toMatch(/^#[0-9a-f]{8}$/);
    expect(toHex('oklch(0.12 0.02 245)')).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('UT-TOK-002 흰색 휘도 1·검정 0, 선형 채널 변환이 경계에서 안정적이다 [NFR-UX-001]', () => {
    expect(relativeLuminance('oklch(1 0 0)')).toBeCloseTo(1, 3);
    expect(relativeLuminance('oklch(0 0 0)')).toBeCloseTo(0, 6);
    const [r, g, b] = oklchToLinearSrgb({ l: 1, c: 0, h: 0, alpha: 1 });
    expect(r).toBeCloseTo(1, 3);
    expect(g).toBeCloseTo(1, 3);
    expect(b).toBeCloseTo(1, 3);
    expect(contrastRatio('oklch(1 0 0)', 'oklch(0 0 0)')).toBeCloseTo(21, 0);
  });
});
