import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  applyDocAttrs,
  readThemePref,
  resolveDocAttrs,
  setThemePref,
  type ThemePref,
  watchSystemTheme,
} from '../../../src/lib/theme.js';

const INIT_PATH = join(import.meta.dirname, '../../../public/theme-init.js');
const INIT_SRC = readFileSync(INIT_PATH, 'utf8');

const LIGHT = '(prefers-color-scheme: light)';
const CONTRAST = '(prefers-contrast: more)';
const TRANSPARENCY = '(prefers-reduced-transparency: reduce)';
const MOTION = '(prefers-reduced-motion: reduce)';

function runInit(stored: string | null | 'THROW', media: ReadonlySet<string>): Record<string, string> {
  const dataset: Record<string, string> = {};
  const doc = { documentElement: { dataset } };
  const win = { matchMedia: (q: string) => ({ matches: media.has(q) }) };
  const ls = {
    getItem: (k: string): string | null => {
      if (stored === 'THROW') {
        throw new Error('blocked');
      }
      return k === 'fathom.theme' ? stored : null;
    },
  };
  new Function('document', 'window', 'localStorage', INIT_SRC)(doc, win, ls);
  return dataset;
}

function fakeStorage(initial: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(initial));
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  };
}

describe('theme', () => {
  it('UT-WEB-035 resolveDocAttrs·applyDocAttrs와 theme-init.js는 같은 규칙이고 저장소 throw는 dark 기본이며 파일은 ≤ 1024바이트·import/export 0이다 [FR-UX-001][FR-UX-006]', () => {
    const medias: ReadonlySet<string>[] = [
      new Set(),
      new Set([LIGHT]),
      new Set([CONTRAST]),
      new Set([TRANSPARENCY, MOTION]),
      new Set([LIGHT, CONTRAST, TRANSPARENCY, MOTION]),
    ];
    for (const pref of ['dark', 'light', 'system'] as ThemePref[]) {
      for (const media of medias) {
        const expected = resolveDocAttrs(pref, (q) => media.has(q));
        const stored = pref === 'dark' ? null : pref;
        const got = runInit(stored, media);
        expect(got, `${pref} ${[...media].join('|')}`).toEqual({
          theme: expected.theme,
          contrast: expected.contrast,
          transparency: expected.transparency,
          motion: expected.motion,
          density: expected.density,
        });
      }
    }
    expect(resolveDocAttrs('system', (q) => q === LIGHT).theme).toBe('light');
    expect(resolveDocAttrs('dark', (q) => q === LIGHT).theme).toBe('dark');
    expect(resolveDocAttrs('light', () => false).theme).toBe('light');
    expect(resolveDocAttrs('dark', () => false)).toEqual({
      theme: 'dark',
      contrast: 'standard',
      transparency: 'full',
      motion: 'full',
      density: 'comfortable',
    });
    expect(runInit('THROW', new Set()).theme).toBe('dark');
    expect(runInit('이상한값', new Set()).theme).toBe('dark');

    const el = document.createElement('div');
    applyDocAttrs(el, {
      theme: 'light',
      contrast: 'more',
      transparency: 'reduce',
      motion: 'reduce',
      density: 'compact',
    });
    expect(el.dataset.theme).toBe('light');
    expect(el.getAttribute('data-contrast')).toBe('more');
    expect(el.getAttribute('data-transparency')).toBe('reduce');
    expect(el.getAttribute('data-motion')).toBe('reduce');
    expect(el.getAttribute('data-density')).toBe('compact');

    expect(readThemePref(fakeStorage({ 'fathom.theme': 'light' }))).toBe('light');
    expect(readThemePref(fakeStorage({ 'fathom.theme': 'system' }))).toBe('system');
    expect(readThemePref(fakeStorage({ 'fathom.theme': '???' }))).toBe('dark');
    expect(readThemePref(fakeStorage())).toBe('dark');

    // setThemePref: 저장 + 즉시 적용, watchSystemTheme: 미디어 변경 추적
    let listeners: (() => void)[] = [];
    let lightNow = false;
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q === LIGHT && lightNow,
      addEventListener: (_t: string, fn: () => void) => listeners.push(fn),
      removeEventListener: (_t: string, fn: () => void) => {
        listeners = listeners.filter((l, i) => !(l === fn && i === listeners.indexOf(fn)));
      },
    }));
    try {
      const root = document.createElement('html');
      setThemePref('light', root);
      expect(root.dataset.theme).toBe('light');
      expect(window.localStorage.getItem('fathom.theme')).toBe('light');
      let pref: ThemePref = 'system';
      const stop = watchSystemTheme(root, () => pref);
      expect(listeners.length).toBe(4);
      lightNow = true;
      for (const fn of listeners) {
        fn();
      }
      expect(root.dataset.theme).toBe('light');
      lightNow = false;
      for (const fn of listeners) {
        fn();
      }
      expect(root.dataset.theme).toBe('dark');
      pref = 'light';
      for (const fn of listeners) {
        fn();
      }
      expect(root.dataset.theme).toBe('light');
      stop();
      expect(listeners.length).toBe(0);
    } finally {
      vi.unstubAllGlobals();
      window.localStorage.removeItem('fathom.theme');
    }

    expect(new TextEncoder().encode(INIT_SRC).length).toBeLessThanOrEqual(1024);
    expect(/^\s*(import|export)\s/m.test(INIT_SRC)).toBe(false);
    expect(INIT_SRC.match(/localStorage\.getItem/g)).toHaveLength(1);
  });
});
