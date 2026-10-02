import { describe, expect, it, vi } from 'vitest';
import { createCsrfStore } from '../../../src/lib/csrf.js';
import { CSRF_43 } from './support/fixtures.js';

describe('csrf', () => {
  it('UT-WEB-016 CsrfStore는 메모리 전용이고 형식 위반 set은 TypeError다 [STD-SEC-26]', () => {
    const setItem = vi.fn();
    const storage = { setItem, getItem: vi.fn(), removeItem: vi.fn() };
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('sessionStorage', storage);
    try {
      const store = createCsrfStore();
      expect(store.get()).toBeNull();
      store.set(CSRF_43);
      expect(store.get()).toBe(CSRF_43);
      expect(() => store.set('짧음')).toThrow(TypeError);
      expect(() => store.set(`${CSRF_43}x`)).toThrow(TypeError);
      expect(store.get()).toBe(CSRF_43);
      store.clear();
      expect(store.get()).toBeNull();
      expect(setItem).not.toHaveBeenCalled();
      expect(storage.getItem).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
