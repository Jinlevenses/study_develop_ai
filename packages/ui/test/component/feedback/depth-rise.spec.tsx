import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DepthRise } from '../../../src/components/depth-rise.js';

const SOURCE = join(import.meta.dirname, '../../../src/components/depth-rise.tsx');

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-motion');
});

describe('DepthRise', () => {
  it('UT-UI-100 role=meter의 aria 값(0..100·round(toRatio×100))과 label·▲ 텍스트가 있다 [FR-DSH-008]', () => {
    render(<DepthRise fromRatio={0.25} toRatio={0.666} label="새로 숙달 2개" />);
    const meter = screen.getByRole('meter');
    expect(meter.getAttribute('aria-valuemin')).toBe('0');
    expect(meter.getAttribute('aria-valuemax')).toBe('100');
    expect(meter.getAttribute('aria-valuenow')).toBe('67');
    expect(meter.getAttribute('aria-valuetext')).toBe('새로 숙달 2개');
    expect(screen.getByText('새로 숙달 2개 ▲')).not.toBeNull();
  });

  it('UT-UI-101 비율은 0..1로 클램프된다(−1 → 0, 2 → 1) [FR-DSH-008]', () => {
    const { unmount } = render(<DepthRise fromRatio={-1} toRatio={2} label="게이지" />);
    expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe('100');
    unmount();
    render(<DepthRise fromRatio={5} toRatio={-1} label="게이지" />);
    expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe('0');
  });

  it('UT-UI-102 기본 모션은 720ms·emphasized 1회이다(반복·카운트업 0) [FR-UX-009]', () => {
    render(<DepthRise fromRatio={0} toRatio={0.5} label="게이지" />);
    const meter = screen.getByRole('meter');
    expect(meter.getAttribute('data-duration')).toBe('0.72');
    expect(meter.getAttribute('data-ease')).toBe('emphasized');
    expect(screen.getByRole('meter').querySelectorAll('[data-fill]')).toHaveLength(1);
  });

  it('UT-UI-103 data-motion=reduce면 애니메이션 duration 0이고 최종 높이를 즉시 그린다 [FR-UX-009]', () => {
    document.documentElement.setAttribute('data-motion', 'reduce');
    render(<DepthRise fromRatio={0.1} toRatio={0.8} label="게이지" />);
    const meter = screen.getByRole('meter');
    expect(meter.getAttribute('data-duration')).toBe('0');
    const fill = meter.querySelector<HTMLElement>('[data-fill]');
    expect(fill?.style.blockSize).toBe('80%');
  });

  it('UT-UI-104 소스에 원색 리터럴이 없고 색은 토큰 클래스뿐이다 [NG-G1][FR-UX-001]', () => {
    const src = readFileSync(SOURCE, 'utf8');
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(src).not.toMatch(/\b(rgba?|hsla?|oklch|oklab|hwb)\(/);
    expect(src).toContain('bg-depth-3');
  });
});
