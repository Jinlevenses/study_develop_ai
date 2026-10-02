import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { readPref, UI_PREF_KEYS, writePref } from '../../../src/lib/ui-prefs.js';

const SRC_ROOT = join(import.meta.dirname, '../../../src');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)],
  );
}

function memoryStorage(): Storage {
  const m = new Map<string, string>();
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

describe('ui-prefs', () => {
  it('UT-WEB-036 허용 키 밖은 TypeError, getItem·setItem throw는 null·false이고 src 전체에서 localStorage·sessionStorage·document.cookie는 ui-prefs.ts 밖에 0이다 [STD-WEB-14][STD-SEC-26]', () => {
    const s = memoryStorage();
    expect(UI_PREF_KEYS).toEqual([
      'fathom.theme',
      'fathom.hat',
      'fathom.keymap.v1',
      'fathom.suggest.home.dismissed_at',
    ]);
    expect(writePref('fathom.hat', 'admin', s)).toBe(true);
    expect(readPref('fathom.hat', s)).toBe('admin');
    expect(writePref('fathom.ctx./map', 'open', s)).toBe(true);
    expect(readPref('fathom.ctx./map', s)).toBe('open');
    expect(writePref('fathom.hat', null, s)).toBe(true);
    expect(readPref('fathom.hat', s)).toBeNull();
    // 허용 키 밖
    expect(() => readPref('fathom.token' as never, s)).toThrow(TypeError);
    expect(() => writePref('csrf' as never, 'x', s)).toThrow(TypeError);
    expect(() => readPref('fathom.ctx.' as never, s)).toThrow(TypeError);
    expect(writePref('fathom.theme', 'x'.repeat(4097), s)).toBe(false); // 길이 초과는 TypeError가 아니라 저장 실패
    expect(readPref('fathom.theme', s)).toBeNull();
    expect(writePref('fathom.theme', 'x'.repeat(4096), s)).toBe(true);
    // 접근 예외
    const broken = {
      ...memoryStorage(),
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    } as Storage;
    expect(readPref('fathom.theme', broken)).toBeNull();
    expect(writePref('fathom.theme', 'dark', broken)).toBe(false);
    expect(writePref('fathom.theme', null, broken)).toBe(false);
    // 저장소 없음
    expect(readPref('fathom.theme', null)).toBeNull();
    expect(writePref('fathom.theme', 'dark', null)).toBe(false);
    // 기본 저장소 접근 자체가 던지는 환경
    vi.stubGlobal('localStorage', undefined);
    expect(readPref('fathom.theme')).toBeNull();
    vi.unstubAllGlobals();
    // 기본 저장소 = globalThis.localStorage
    expect(writePref('fathom.theme', 'light')).toBe(true);
    expect(readPref('fathom.theme')).toBe('light');
    window.localStorage.removeItem('fathom.theme');

    // 텍스트 스캔: ui-prefs.ts 밖에는 저장소·쿠키 직접 접근 문자열이 없다
    const offenders: string[] = [];
    for (const file of walk(SRC_ROOT)) {
      const rel = relative(SRC_ROOT, file);
      if (rel === join('lib', 'ui-prefs.ts')) {
        continue;
      }
      const text = readFileSync(file, 'utf8');
      for (const needle of ['localStorage', 'sessionStorage', 'document.cookie']) {
        if (text.includes(needle)) {
          offenders.push(`${rel}: ${needle}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
