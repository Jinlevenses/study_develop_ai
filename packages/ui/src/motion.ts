import { EASE, TOKENS } from '@fathom/design-tokens/tokens';
import type { Transition } from 'motion/react';
import { useReducedMotion } from 'motion/react';

export const springCard = { type: 'spring', bounce: 0.12, duration: 0.35 } as const satisfies Transition;
export const REDUCED_TRANSITION = { duration: 0.12, ease: 'linear' } as const satisfies Transition;
export const MOTION_CONFIG_PROPS = { reducedMotion: 'user' } as const;

export type MotionKind = 'instant' | 'fast' | 'base' | 'exit' | 'spring';

export function transitionFor(kind: MotionKind, reduced: boolean): Transition {
  if (reduced) {
    return REDUCED_TRANSITION;
  }
  if (kind === 'spring') {
    return springCard;
  }
  if (kind === 'exit') {
    return { duration: TOKENS.dur.exit / 1000, ease: EASE.exit };
  }
  return { duration: TOKENS.dur[kind] / 1000, ease: EASE.standard };
}

export function prefersReducedMotion(doc?: Document): boolean {
  const d = doc ?? (typeof document === 'undefined' ? undefined : document);
  if (d === undefined) {
    return false;
  }
  const attr = d.documentElement.getAttribute('data-motion');
  if (attr === 'reduce') {
    return true;
  }
  if (attr === 'full') {
    return false;
  }
  const match = d.defaultView?.matchMedia ?? (typeof matchMedia === 'function' ? matchMedia : undefined);
  if (typeof match !== 'function') {
    return false;
  }
  return match.call(d.defaultView ?? globalThis, '(prefers-reduced-motion: reduce)').matches;
}

export function useReducedMotionPreference(): boolean {
  return useReducedMotion() === true || prefersReducedMotion();
}
