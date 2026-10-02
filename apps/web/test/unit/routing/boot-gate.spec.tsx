import 'fake-indexeddb/auto';
import { SessionsAttemptsSubmitRoute } from '@fathom/contracts/http/gateway/v1/sessions';
import { createFakeClock } from '@fathom/testkit/clock';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { openDB } from 'idb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BootGate, createBootSignals } from '../../../src/features/shell/chrome/boot-gate.js';
import { createQueueCountsSource, QueueHost } from '../../../src/features/shell/chrome/shell-deps.js';
import { createApiClient } from '../../../src/lib/api-client.js';
import { APP_VERSION } from '../../../src/lib/app-version.js';
import { type AttemptRecord, openAttemptQueue, readAttemptCounts } from '../../../src/lib/attempt-queue.js';
import type { BootState } from '../../../src/lib/bootstrap.js';
import { bootstrapSession } from '../../../src/lib/bootstrap.js';
import { createCsrfStore } from '../../../src/lib/csrf.js';
import {
  attemptPayload,
  CSRF_43,
  fakeFetch,
  jsonResponse,
  newAttempt,
  problemBody,
  problemResponse,
  TOKEN_43,
  ULID_A,
} from '../lib/support/fixtures.js';

const showToast = vi.hoisted(() => vi.fn());
vi.mock('@fathom/ui/components/toast', () => ({ showToast, Toaster: () => null }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  showToast.mockClear();
});

const STATUS = {
  authenticated: true as const,
  port: 4747,
  app_version: '0.0.0',
  boot_id: '01J0000000000000000000000A',
  profile: 'dev' as const,
  safe_mode: false,
  maintenance: 'none' as const,
};

function gate(boot: () => Promise<BootState>, queueCounts = createQueueCountsSource()) {
  const signals = createBootSignals();
  const view = render(
    <BootGate boot={boot} signals={signals} queueCounts={queueCounts.source}>
      {() => <div>준비된 앱</div>}
    </BootGate>,
  );
  return { signals, view, queueCounts };
}

describe('boot gate', () => {
  it('UT-WEB-453 BootGate: session_lost 문구·명령 복사, app_off 문구·미전송 n건, error는 첫 행동 포커스, versionMismatch는 토스트 1회·location.reload 미호출이다 [FR-SET-023][NFR-SEC-019]', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    // session_lost
    const lost = gate(() => Promise.resolve({ kind: 'session_lost', code: 'GW-AUTH-001' }));
    await screen.findByText('브라우저 세션이 끊겼습니다.');
    expect(screen.getByText(/을 실행하면 바로 이어집니다\./).textContent).toBe(
      '터미널에서 fathom open을 실행하면 바로 이어집니다.',
    );
    expect(screen.getByText('fathom open').tagName).toBe('CODE');
    fireEvent.click(screen.getByRole('button', { name: '명령 복사' }));
    expect(writeText).toHaveBeenCalledWith('fathom open');
    lost.view.unmount();

    // 클립보드 실패는 무시
    writeText.mockImplementationOnce(() => Promise.reject(new Error('denied')));
    const lost2 = gate(() => Promise.resolve({ kind: 'session_lost', code: 'GW-AUTH-003' }));
    fireEvent.click(await screen.findByRole('button', { name: '명령 복사' }));
    lost2.view.unmount();

    // app_off + 미전송 n건
    const counts = createQueueCountsSource({ pending: 2, sending: 1, failed_permanent: 0, retryInMs: null });
    const off = gate(() => Promise.resolve({ kind: 'app_off' }), counts);
    await screen.findByText('Fathom이 꺼져 있습니다 — fathom open으로 켜기');
    expect(screen.getByText('보내지 못한 응답 3건은 켜지면 자동 전송됩니다')).toBeTruthy();
    act(() => counts.notify({ pending: 0, sending: 0, failed_permanent: 0, retryInMs: null }));
    expect(screen.queryByText(/자동 전송됩니다/)).toBeNull();
    expect(screen.getByRole('button', { name: '명령 복사' })).toBeTruthy();
    off.view.unmount();

    // error: 첫 행동 포커스 + 다시 시도
    const boot = vi
      .fn<() => Promise<BootState>>()
      .mockResolvedValueOnce({
        kind: 'error',
        failure: { kind: 'problem', status: 500, problem: problemBody(500, 'GW-INTERNAL-001') },
      })
      .mockResolvedValueOnce({ kind: 'ready', status: STATUS, versionMismatch: false });
    const err = gate(boot);
    const retry = await screen.findByRole('button', { name: '다시 시도' });
    expect(document.activeElement).toBe(retry);
    expect(screen.getByText('문제가 발생했습니다')).toBeTruthy();
    expect(screen.getByText('GW-INTERNAL-001')).toBeTruthy();
    expect(screen.getByText('01J0000000000000000000000A')).toBeTruthy();
    fireEvent.click(retry);
    await screen.findByText('준비된 앱');
    expect(boot).toHaveBeenCalledTimes(2);
    err.view.unmount();

    const generic = gate(() =>
      Promise.resolve({ kind: 'error', failure: { kind: 'contract', status: 200, detail: 'x' } }),
    );
    await screen.findByText('앱을 시작하지 못했습니다');
    expect(screen.getByText('WEB-BOOT')).toBeTruthy();
    generic.view.unmount();

    // versionMismatch → 토스트 1회, reload 미호출
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    const mismatch = gate(() => Promise.resolve({ kind: 'ready', status: STATUS, versionMismatch: true }));
    await screen.findByText('준비된 앱');
    expect(showToast).toHaveBeenCalledTimes(1);
    const toast = showToast.mock.calls[0]?.[0] as {
      type: string;
      title: string;
      description: string;
      action: { label: string; onSelect: () => void };
    };
    expect(toast).toMatchObject({
      type: 'warn',
      title: '새 버전이 준비되었습니다',
      description: '새로고침하면 적용됩니다',
    });
    expect(toast.action.label).toBe('새로고침');
    act(() => mismatch.signals.versionMismatch());
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
    toast.action.onSelect();
    expect(reload).toHaveBeenCalledTimes(1);

    // 실행 중 onSessionLost → session_lost로 전환
    act(() => mismatch.signals.sessionLost('GW-AUTH-003'));
    await screen.findByText('브라우저 세션이 끊겼습니다.');
    mismatch.view.unmount();

    // 로딩 중에는 아무것도 그리지 않고(300ms 전) 끝나면 앱을 그린다
    let resolve: (s: BootState) => void = () => undefined;
    const slow = gate(() => new Promise<BootState>((r) => (resolve = r)));
    expect(slow.view.container.textContent).toBe('');
    resolve({ kind: 'ready', status: STATUS, versionMismatch: false });
    await waitFor(() => expect(screen.getByText('준비된 앱')).toBeTruthy());
    expect(showToast).toHaveBeenCalledTimes(1);
  });
  it('UT-WEB-453 attempt 큐는 BootGate가 ready가 된 뒤에만 열려 교환·status·csrf보다 먼저 attempts 요청이 나가지 않는다 [NFR-SEC-019][NFR-AVL-002]', async () => {
    const clock = createFakeClock();
    const seed = async (dbName: string): Promise<void> => {
      const db = await openDB(dbName, 1, {
        upgrade(upgradeDb) {
          upgradeDb.createObjectStore('attempts', { keyPath: 'idempotency_key' });
        },
      });
      const rec: AttemptRecord = {
        ...newAttempt(ULID_A),
        payload: attemptPayload(ULID_A),
        created_at: clock.now() - 1000,
        tries: 0,
        state: 'pending',
        last_error_code: null,
      };
      await db.put('attempts', rec);
      db.close();
    };
    const statusBody = {
      authenticated: true,
      port: 4747,
      app_version: APP_VERSION,
      boot_id: ULID_A,
      profile: 'dev',
      safe_mode: false,
      maintenance: 'none',
    };
    const mount = (dbName: string, responses: Parameters<typeof fakeFetch>) => {
      const f = fakeFetch(...responses);
      const csrf = createCsrfStore();
      const api = createApiClient({ fetch: f.fetch, csrf, newKey: () => 'K' });
      const queueCounts = createQueueCountsSource();
      const history = { state: null, replaceState: vi.fn() };
      const location = { hash: `#bt=${TOKEN_43}`, pathname: '/', search: '' };
      const open = () =>
        openAttemptQueue({
          dbName,
          send: (rec) =>
            api.call(
              SessionsAttemptsSubmitRoute,
              { params: { session_id: rec.session_id }, body: rec.payload },
              { idempotencyKey: rec.idempotency_key },
            ),
          now: clock.now,
          setTimer: () => 0,
          clearTimer: () => undefined,
          onChange: queueCounts.notify,
        });
      render(
        <BootGate
          boot={() => bootstrapSession({ location, history, api, csrf })}
          signals={createBootSignals()}
          queueCounts={queueCounts.source}
        >
          {() => <QueueHost open={open}>{() => <div>큐 열림</div>}</QueueHost>}
        </BootGate>,
      );
      return f;
    };

    // 세션이 끊긴 상태: 큐를 열지 않으므로 attempts 요청 0 · 레코드는 pending으로 남아 나중에 자동 전송된다
    const lostDb = 'boot-queue-lost';
    await seed(lostDb);
    const lost = mount(lostDb, [
      () => jsonResponse(200, { session_established: true, port: 4747, app_version: APP_VERSION, profile: 'dev' }),
      () => problemResponse(401, 'GW-AUTH-003'),
    ]);
    await screen.findByText('브라우저 세션이 끊겼습니다.');
    expect(lost.calls.map((c) => c.url)).toEqual(['/api/v1/session/exchange', '/api/v1/session']);
    expect(await readAttemptCounts({ now: clock.now, dbName: lostDb })).toEqual({
      pending: 1,
      sending: 0,
      failed_permanent: 0,
      retryInMs: null,
    });
    cleanup();

    // 정상 부트: 교환 → status → csrf가 끝난 뒤에야 attempts가 나가고 CSRF 헤더가 실린다
    const okDb = 'boot-queue-ok';
    await seed(okDb);
    const ok = mount(okDb, [
      () => jsonResponse(200, { session_established: true, port: 4747, app_version: APP_VERSION, profile: 'dev' }),
      () => jsonResponse(200, statusBody),
      () => jsonResponse(200, { csrf: CSRF_43 }),
      () => problemResponse(503, 'GW-UNAVAILABLE-001'),
    ]);
    await screen.findByText('큐 열림');
    await waitFor(() => expect(ok.calls).toHaveLength(4));
    const urls = ok.calls.map((c) => c.url);
    expect(urls.slice(0, 3)).toEqual(['/api/v1/session/exchange', '/api/v1/session', '/api/v1/session/csrf']);
    expect(urls[3]).toBe(`/api/v1/sessions/${ULID_A}/attempts`);
    expect(ok.calls[3]?.headers['x-fathom-csrf']).toBe(CSRF_43);
  });
});
