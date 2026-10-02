import { useSyncExternalStore } from 'react';
import { readPref, writePref } from './ui-prefs.js';

export type ThemePref = 'dark' | 'light' | 'system';

export interface DocAttrs {
  readonly theme: 'dark' | 'light';
  readonly contrast: 'standard' | 'more';
  readonly transparency: 'full' | 'reduce';
  readonly motion: 'full' | 'reduce';
  readonly density: 'comfortable' | 'compact';
}

export const MEDIA_LIGHT = '(prefers-color-scheme: light)';
export const MEDIA_CONTRAST = '(prefers-contrast: more)';
export const MEDIA_TRANSPARENCY = '(prefers-reduced-transparency: reduce)';
export const MEDIA_MOTION = '(prefers-reduced-motion: reduce)';

export function readThemePref(storage?: Storage | null): ThemePref {
  const v = readPref('fathom.theme', storage);
  return v === 'light' || v === 'system' || v === 'dark' ? v : 'dark';
}

/** DS-01 §2.2 — `public/theme-init.js`와 같은 규칙. */
export function resolveDocAttrs(pref: ThemePref, mq: (q: string) => boolean): DocAttrs {
  const theme = pref === 'system' ? (mq(MEDIA_LIGHT) ? 'light' : 'dark') : pref;
  return {
    theme,
    contrast: mq(MEDIA_CONTRAST) ? 'more' : 'standard',
    transparency: mq(MEDIA_TRANSPARENCY) ? 'reduce' : 'full',
    motion: mq(MEDIA_MOTION) ? 'reduce' : 'full',
    density: 'comfortable',
  };
}

export function applyDocAttrs(el: HTMLElement, a: DocAttrs): void {
  el.dataset.theme = a.theme;
  el.dataset.contrast = a.contrast;
  el.dataset.transparency = a.transparency;
  el.dataset.motion = a.motion;
  el.dataset.density = a.density;
}

/** 현재 창의 `matchMedia`를 `(q) => boolean`으로 감싼다(없으면 항상 false). */
export function windowMedia(): (q: string) => boolean {
  return (q: string): boolean => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia(q).matches;
  };
}

export function setThemePref(pref: ThemePref, el: HTMLElement = document.documentElement): void {
  writePref('fathom.theme', pref);
  applyDocAttrs(el, resolveDocAttrs(pref, windowMedia()));
}

/**
 * 시스템 미디어 질의 변경을 따라 속성을 다시 적용한다. 테마 색은 pref가 `system`일 때만 바뀌고,
 * 대비·투명·모션 속성은 항상 OS 설정을 따른다. 해제 함수를 돌려준다.
 */
export function watchSystemTheme(el: HTMLElement, getPref: () => ThemePref): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => undefined;
  }
  const lists = [MEDIA_LIGHT, MEDIA_CONTRAST, MEDIA_TRANSPARENCY, MEDIA_MOTION].map((q) => window.matchMedia(q));
  const onChange = (): void => {
    applyDocAttrs(el, resolveDocAttrs(getPref(), windowMedia()));
  };
  for (const l of lists) {
    l.addEventListener('change', onChange);
  }
  return () => {
    for (const l of lists) {
      l.removeEventListener('change', onChange);
    }
  };
}

/** 현재 문서의 `data-theme`(없으면 dark). */
export function currentDocTheme(): 'dark' | 'light' {
  if (typeof document === 'undefined') {
    return 'dark';
  }
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function subscribeDocTheme(onChange: () => void): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
    return () => undefined;
  }
  const mo = new MutationObserver(onChange);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => mo.disconnect();
}

/** `data-theme` 변경을 따라 다시 렌더하는 훅(코드·다이어그램 색을 문서 테마에 맞춘다). */
export function useDocTheme(): 'dark' | 'light' {
  return useSyncExternalStore(subscribeDocTheme, currentDocTheme, () => 'dark');
}
