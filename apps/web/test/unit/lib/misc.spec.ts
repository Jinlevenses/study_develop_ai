import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { safeSearch } from '../../../src/lib/search.js';
import { registerServiceWorker } from '../../../src/lib/sw-register.js';

describe('misc', () => {
  it('UT-WEB-042 registerServiceWorker는 skipped를 돌려주고 navigator.serviceWorker.register를 부르지 않는다 [AQ-16]', async () => {
    const register = vi.fn();
    vi.stubGlobal('navigator', { ...navigator, serviceWorker: { register } });
    try {
      expect(await registerServiceWorker()).toBe('skipped');
      expect(register).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('UT-WEB-043 APP_VERSION은 define이 없으면 0.0.0, 있으면 주입 값이고 CLIENT_HEADER는 web/로 시작한다 [NFR-MAINT-006]', async () => {
    const mod = await import('../../../src/lib/app-version.js');
    expect(mod.APP_VERSION).toBe('0.0.0');
    expect(mod.CLIENT_HEADER).toMatch(/^web\//);
    expect(mod.CLIENT_HEADER).toBe('web/0.0.0');
    vi.resetModules();
    vi.stubGlobal('__FATHOM_APP_VERSION__', '1.2.3');
    try {
      const injected = await import('../../../src/lib/app-version.js');
      expect(injected.APP_VERSION).toBe('1.2.3');
      expect(injected.CLIENT_HEADER).toBe('web/1.2.3');
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });

  it('UT-WEB-044 safeSearch는 유효 값을 통과시키고 미지 키·잘못된 값은 {}로 바꾸며 숫자로 바뀐 문자열은 coerce한다 [FR-DSH-004]', () => {
    const Schema = z
      .object({
        tab: z.enum(['theory', 'code']).optional(),
        lens: z.coerce.number().int().min(1).max(5).optional(),
        edit: z.coerce.string().pipe(z.literal('1')).optional(),
      })
      .strict();
    const parse = safeSearch(Schema);
    expect(parse({ tab: 'code', lens: 3 })).toEqual({ tab: 'code', lens: 3 });
    expect(parse({ lens: '3' })).toEqual({ lens: 3 });
    expect(parse({ edit: 1 })).toEqual({ edit: '1' });
    expect(parse({ edit: '1' })).toEqual({ edit: '1' });
    expect(parse({ unknown: 'x' })).toEqual({});
    expect(parse({ tab: 'nope' })).toEqual({});
    expect(parse({ lens: 9 })).toEqual({});
    expect(parse({})).toEqual({});
  });
});
