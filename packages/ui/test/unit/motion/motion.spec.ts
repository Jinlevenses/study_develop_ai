import { EASE } from '@fathom/design-tokens/tokens';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MOTION_CONFIG_PROPS,
  prefersReducedMotion,
  REDUCED_TRANSITION,
  springCard,
  transitionFor,
} from '../../../src/motion.js';

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  document.documentElement.removeAttribute('data-motion');
  vi.unstubAllGlobals();
  window.matchMedia = originalMatchMedia;
});

describe('motion', () => {
  it('UT-UI-094 transitionFor는 reduced면 모든 kind가 REDUCED_TRANSITION, 아니면 토큰 기반이다 [FR-UX-009]', () => {
    for (const kind of ['instant', 'fast', 'base', 'exit', 'spring'] as const) {
      expect(transitionFor(kind, true)).toBe(REDUCED_TRANSITION);
    }
    expect(transitionFor('fast', false)).toEqual({ duration: 0.15, ease: EASE.standard });
    expect(transitionFor('instant', false)).toEqual({ duration: 0.09, ease: EASE.standard });
    expect(transitionFor('base', false)).toEqual({ duration: 0.22, ease: EASE.standard });
    expect(transitionFor('exit', false)).toEqual({ duration: 0.16, ease: EASE.exit });
    expect(transitionFor('spring', false)).toBe(springCard);
    expect(springCard).toMatchObject({ type: 'spring', bounce: 0.12, duration: 0.35 });
    expect(REDUCED_TRANSITION).toEqual({ duration: 0.12, ease: 'linear' });
  });

  it('UT-UI-095 prefersReducedMotion은 data-motion 속성 → matchMedia 순으로 판정한다 [FR-UX-009]', () => {
    const doc = document;
    doc.documentElement.setAttribute('data-motion', 'reduce');
    expect(prefersReducedMotion(doc)).toBe(true);
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    doc.documentElement.setAttribute('data-motion', 'full');
    expect(prefersReducedMotion(doc)).toBe(false);
    doc.documentElement.removeAttribute('data-motion');
    expect(prefersReducedMotion(doc)).toBe(true);
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    expect(prefersReducedMotion(doc)).toBe(false);
    vi.stubGlobal('matchMedia', undefined);
    window.matchMedia = undefined as never;
    expect(prefersReducedMotion(doc)).toBe(false);
    expect(MOTION_CONFIG_PROPS.reducedMotion).toBe('user');
  });
});
