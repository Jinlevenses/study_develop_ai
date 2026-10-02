import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../../../src/lib/api-client.js';
import { APP_VERSION } from '../../../src/lib/app-version.js';
import { bootstrapSession, readBootstrapToken } from '../../../src/lib/bootstrap.js';
import { createCsrfStore } from '../../../src/lib/csrf.js';
import { CSRF_43, fakeFetch, jsonResponse, problemResponse, TOKEN_43, ULID_A } from './support/fixtures.js';

function statusBody(appVersion: string) {
  return {
    authenticated: true,
    port: 4747,
    app_version: appVersion,
    boot_id: ULID_A,
    profile: 'dev',
    safe_mode: false,
    maintenance: 'none',
  };
}
const EXCHANGE = { session_established: true, port: 4747, app_version: APP_VERSION, profile: 'dev' };

function setup(hash: string, responses: Parameters<typeof fakeFetch>) {
  const events: string[] = [];
  const f = fakeFetch(...responses);
  const wrapped: typeof fetch = (input, init) => {
    events.push(`fetch ${String(input)}`);
    return f.fetch(input, init);
  };
  const csrf = createCsrfStore();
  const api = createApiClient({ fetch: wrapped, csrf, newKey: () => 'K' });
  const history = {
    state: { x: 1 },
    replaceState: vi.fn((_state: unknown, _unused: string, url?: string | URL | null) => {
      events.push(`replaceState ${String(url)}`);
    }),
  };
  const location = { hash, pathname: '/map', search: '?track=k8s' };
  return { run: () => bootstrapSession({ location, history, api, csrf }), events, history, f, csrf };
}

describe('bootstrap', () => {
  it('UT-WEB-003 #bt=<43자>는 replaceState가 첫 fetch보다 먼저고 exchange body {bt} → status → csrf 순서이며, 짧은 토큰은 해시만 지우고 exchange를 생략한다 [NFR-SEC-019][IF-GW-002]', async () => {
    const t = setup(`#bt=${TOKEN_43}`, [
      () => jsonResponse(200, EXCHANGE),
      () => jsonResponse(200, statusBody(APP_VERSION)),
      () => jsonResponse(200, { csrf: CSRF_43 }),
    ]);
    const state = await t.run();
    expect(state.kind).toBe('ready');
    expect(t.events).toEqual([
      'replaceState /map?track=k8s',
      'fetch /api/v1/session/exchange',
      'fetch /api/v1/session',
      'fetch /api/v1/session/csrf',
    ]);
    expect(t.history.replaceState).toHaveBeenCalledWith({ x: 1 }, '', '/map?track=k8s');
    expect(t.f.calls[0]?.init.body).toBe(JSON.stringify({ bt: TOKEN_43 }));
    expect(t.csrf.get()).toBe(CSRF_43);
    expect(JSON.stringify(state)).not.toContain(TOKEN_43);

    const short = setup('#bt=짧음', [
      () => jsonResponse(200, statusBody(APP_VERSION)),
      () => jsonResponse(200, { csrf: CSRF_43 }),
    ]);
    await short.run();
    expect(short.events[0]).toBe('replaceState /map?track=k8s');
    expect(short.events.filter((e) => e.includes('exchange'))).toHaveLength(0);
    expect(readBootstrapToken(`#bt=${TOKEN_43}`)).toBe(TOKEN_43);
    expect(readBootstrapToken(`#bt=${TOKEN_43}x`)).toBeNull();
    expect(readBootstrapToken(`#x=1#bt=${TOKEN_43}`)).toBeNull();
    expect(readBootstrapToken('')).toBeNull();
  });

  it('UT-WEB-017 해시 없음 ready · status 401 session_lost · fetch throw app_off · exchange 401 AUTH-004 계속 · 500 error다 [FR-SET-023][NFR-SEC-019]', async () => {
    const none = setup('', [
      () => jsonResponse(200, statusBody(APP_VERSION)),
      () => jsonResponse(200, { csrf: CSRF_43 }),
    ]);
    expect((await none.run()).kind).toBe('ready');
    expect(none.history.replaceState).not.toHaveBeenCalled();
    expect(none.events).toEqual(['fetch /api/v1/session', 'fetch /api/v1/session/csrf']);

    const lost = setup('', [() => problemResponse(401, 'GW-AUTH-001')]);
    expect(await lost.run()).toEqual({ kind: 'session_lost', code: 'GW-AUTH-001' });

    const off = setup('', [new Error('refused')]);
    expect(await off.run()).toEqual({ kind: 'app_off' });

    const reuse = setup(`#bt=${TOKEN_43}`, [
      () => problemResponse(401, 'GW-AUTH-004'),
      () => jsonResponse(200, statusBody(APP_VERSION)),
      () => jsonResponse(200, { csrf: CSRF_43 }),
    ]);
    expect((await reuse.run()).kind).toBe('ready');

    const exchange500 = setup(`#bt=${TOKEN_43}`, [() => problemResponse(500, 'GW-INTERNAL-001')]);
    const err = await exchange500.run();
    expect(err.kind).toBe('error');
    const status500 = setup('', [() => problemResponse(500, 'GW-INTERNAL-001')]);
    expect((await status500.run()).kind).toBe('error');
    const csrfLost = setup('', [
      () => jsonResponse(200, statusBody(APP_VERSION)),
      () => problemResponse(401, 'GW-AUTH-003'),
    ]);
    expect(await csrfLost.run()).toEqual({ kind: 'session_lost', code: 'GW-AUTH-003' });
    const exchangeOff = setup(`#bt=${TOKEN_43}`, [new Error('refused')]);
    expect(await exchangeOff.run()).toEqual({ kind: 'app_off' });
  });

  it('UT-WEB-018 status.app_version이 APP_VERSION과 다르면 versionMismatch true, 같으면 false다 [NFR-MAINT-006]', async () => {
    const same = setup('', [
      () => jsonResponse(200, statusBody(APP_VERSION)),
      () => jsonResponse(200, { csrf: CSRF_43 }),
    ]);
    expect(await same.run()).toMatchObject({ kind: 'ready', versionMismatch: false });
    const diff = setup('', [() => jsonResponse(200, statusBody('9.9.9')), () => jsonResponse(200, { csrf: CSRF_43 })]);
    expect(await diff.run()).toMatchObject({ kind: 'ready', versionMismatch: true });
  });
});
