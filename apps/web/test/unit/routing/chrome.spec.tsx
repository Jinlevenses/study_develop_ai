import type { Banner as BannerT } from '@fathom/contracts/http/ops/v1/health';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConnectionChip } from '../../../src/features/shell/chrome/connection-chip.js';
import { OpsAlertSlot } from '../../../src/features/shell/chrome/ops-alert-slot.js';
import { createHatStore, useHatStore } from '../../../src/stores/hat.js';
import { useHotkeysStore } from '../../../src/stores/hotkeys.js';
import { useLayoutStore } from '../../../src/stores/layout.js';
import { usePaletteStore } from '../../../src/stores/palette.js';
import { homeView, jsonResponse, ULID_A } from '../lib/support/fixtures.js';
import { renderApp, SAMPLE_ULID } from './support/harness.js';

const HELLO = (mode: string): string =>
  JSON.stringify({ boot_id: ULID_A, hub_seq: 0, server_time: 1_790_000_000_000, app_version: '0.0.0', ai_mode: mode });

const PATHS = [
  '/',
  `/session/${SAMPLE_ULID}`,
  '/concepts/k8s.probes',
  '/map',
  '/evidence/k8s.probes',
  `/notes/${SAMPLE_ULID}`,
  `/dig/${SAMPLE_ULID}`,
  `/cases/${SAMPLE_ULID}`,
  `/artifacts/${SAMPLE_ULID}`,
  '/review/weekly',
  '/season',
  '/inbox',
  `/imports/${SAMPLE_ULID}`,
  '/curation',
  '/ai',
  '/ops',
  '/settings',
  '/_design',
];

const ADMIN_LABELS = ['가져오기', '큐레이션', 'AI', '운영', '설정'];

function banner(id: string, severity: BannerT['severity'], since: number, href: string | null): BannerT {
  return {
    banner_id: id,
    code: 'service_degraded',
    severity,
    message_ko: `배너 ${id}`,
    since,
    dismissible: false,
    action: href === null ? null : { label_ko: '자세히', href, cli: null },
  };
}

async function findHeader(): Promise<HTMLElement> {
  await screen.findByRole('navigation', { name: '주요 메뉴' });
  const header = document.querySelector('header');
  if (header === null) {
    throw new Error('헤더가 없습니다');
  }
  return header;
}

function press(target: Element | Document, init: KeyboardEventInit): void {
  fireEvent.keyDown(target, init);
}

describe('shell chrome', () => {
  it('UT-WEB-447 18개 경로 모두에서 AiChip이 보이고 초기값 AI: 오프라인·hello FULL은 AI: 전체·home degraded_badge는 격하다 [FR-UX-010][FR-AI-003]', async () => {
    for (const path of PATHS) {
      const app = renderApp(path);
      const header = await findHeader();
      expect(await within(header).findByText('AI: 오프라인'), path).toBeTruthy();
      act(() => app.es().emit('hello', HELLO('FULL')));
      expect(await within(header).findByText('AI: 전체'), path).toBeTruthy();
      app.utils.unmount();
      cleanup();
    }
    const degraded = renderApp('/map', {
      responses: [() => jsonResponse(200, homeView({ mode: 'JUDGE_ONLY', degraded: true }))],
    });
    const header = await findHeader();
    expect(await within(header).findByText(/AI: 판단만/)).toBeTruthy();
    expect(within(header).getByText(/격하/)).toBeTruthy();
    expect(degraded.fetchCalls()).toContain('/api/v1/home');
  });

  it('UT-WEB-448 학습 모자는 관리 그룹 5항목을 렌더하지 않고 관리 모자는 렌더하며 Header 하단 띠가 강해지고 fathom.hat이 저장·복원된다 [FR-SET-010]', async () => {
    renderApp('/');
    const nav = await screen.findByRole('navigation', { name: '주요 메뉴' });
    for (const label of ADMIN_LABELS) {
      expect(within(nav).queryByRole('link', { name: label }), label).toBeNull();
    }
    const header = document.querySelector('header');
    expect(header?.className).toContain('border-border');
    expect(header?.className).not.toContain('border-border-strong');
    expect(within(nav).getByRole('link', { name: '홈' }).getAttribute('aria-current')).toBe('page');

    act(() => useHatStore.getState().setHat('admin'));
    for (const label of ADMIN_LABELS) {
      expect(within(nav).getByRole('link', { name: label }), label).toBeTruthy();
    }
    expect(document.querySelector('header')?.className).toContain('border-border-strong');
    expect(window.localStorage.getItem('fathom.hat')).toBe('admin');
    // 복원: 같은 저장소를 읽는 새 스토어
    expect(createHatStore().getState().hat).toBe('admin');
    // 모자 전환 UI
    fireEvent.click(screen.getByRole('radio', { name: '학습' }));
    await waitFor(() => expect(useHatStore.getState().hat).toBe('learn'));
    expect(window.localStorage.getItem('fathom.hat')).toBe('learn');
    expect(screen.getByRole('group', { name: '작업 모드' })).toBeTruthy();
  });

  it('UT-WEB-449 OpsAlertSlot은 critical > warn·info 제외·+n이고 학습 모자는 행동 0·관리 모자는 링크 1이다 [FR-SET-017][NFR-AVL-005]', () => {
    const banners = [
      banner('A', 'info', 900, '/ops'),
      banner('B', 'warn', 500, '/ops'),
      banner('C', 'critical', 100, '/ai'),
      banner('D', 'warn', 700, '/ops'),
    ];
    const learn = render(<OpsAlertSlot banners={banners} hat="learn" />);
    expect(learn.container.textContent).toContain('배너 C');
    expect(learn.container.textContent).toContain('+2');
    expect(learn.container.textContent).not.toContain('배너 A');
    expect(learn.container.querySelectorAll('a, button')).toHaveLength(0);
    learn.unmount();

    const admin = render(<OpsAlertSlot banners={banners} hat="admin" />);
    const links = admin.container.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute('href')).toBe('/ai');
    expect(links[0]?.textContent).toBe('자세히');
    admin.unmount();

    // 같은 등급은 since 최신 1개
    const warns = render(
      <OpsAlertSlot banners={[banner('B', 'warn', 500, null), banner('D', 'warn', 700, null)]} hat="admin" />,
    );
    expect(warns.container.textContent).toContain('배너 D');
    expect(warns.container.textContent).toContain('+1');
    expect(warns.container.querySelectorAll('a, button')).toHaveLength(0);
    warns.unmount();

    const none = render(<OpsAlertSlot banners={[banner('A', 'info', 1, null)]} hat="admin" />);
    expect(none.container.innerHTML).toBe('');
  });

  it('UT-WEB-450 ConnectionChip은 상태 4종 텍스트·큐 대기·영구 문구·안전 모드를 보인다 [NFR-AVL-002]', () => {
    const empty = { pending: 0, sending: 0, failed_permanent: 0, retryInMs: null };
    const texts = (state: 'open' | 'connecting' | 'reconnecting' | 'closed'): string => {
      const r = render(<ConnectionChip state={state} queue={empty} safeMode={false} />);
      const t = r.container.textContent ?? '';
      r.unmount();
      return t;
    };
    expect(texts('open')).toContain('연결됨');
    expect(texts('connecting')).toContain('재연결 중');
    expect(texts('reconnecting')).toContain('재연결 중');
    expect(texts('closed')).toContain('연결 끊김');
    const waiting = render(
      <ConnectionChip state="open" queue={{ pending: 2, sending: 1, failed_permanent: 1, retryInMs: null }} safeMode />,
    );
    expect(waiting.container.textContent).toContain('전송 대기 3');
    expect(waiting.container.textContent).toContain('보내지 못한 응답 1');
    expect(waiting.container.textContent).toContain('안전 모드');
    waiting.unmount();
    const quiet = render(<ConnectionChip state="open" queue={empty} safeMode={false} />);
    expect(quiet.container.textContent).not.toContain('전송 대기');
    expect(quiet.container.textContent).not.toContain('보내지 못한 응답');
    expect(quiet.container.textContent).not.toContain('안전 모드');
  });

  it('UT-WEB-451 Mod+\\는 Context 패널을 토글하고 fathom.ctx.<route>에 저장하며 md 미만에는 BottomTabs 4항목이 있다 [FR-UX-010][NFR-UX-010]', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('min-width'),
      media: q,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    try {
      renderApp('/map');
      await screen.findByRole('complementary', { name: '맥락 패널' });
      expect(screen.getByText('이 화면의 맥락 정보가 여기에 표시됩니다')).toBeTruthy();
      press(document.body, { code: 'Backslash', ctrlKey: true });
      await waitFor(() => expect(screen.queryByRole('complementary', { name: '맥락 패널' })).toBeNull());
      expect(window.localStorage.getItem('fathom.ctx./map')).toBe('0');
      press(document.body, { code: 'Backslash', ctrlKey: true });
      await screen.findByRole('complementary', { name: '맥락 패널' });
      expect(window.localStorage.getItem('fathom.ctx./map')).toBe('1');
      // 다른 화면은 영향을 받지 않는다
      expect(window.localStorage.getItem('fathom.ctx./inbox')).toBeNull();
      expect(useLayoutStore.getState().contextOpen['/map']).toBe(true);
      // 하단 탭
      const tabs = screen.getByRole('navigation', { name: '하단 메뉴' });
      expect(
        within(tabs)
          .getAllByRole('link')
          .map((l) => l.getAttribute('aria-label')),
      ).toEqual(['홈', '세션', '지도', '리뷰']);
      expect(tabs.className).toContain('md:hidden');
    } finally {
      vi.unstubAllGlobals();
    }
    // lg 미만에서는 Drawer로 연다
    cleanup();
    useLayoutStore.setState({ contextOpen: {}, drawerOpen: false });
    renderApp('/map');
    await screen.findByRole('navigation', { name: '주요 메뉴' });
    press(document.body, { code: 'Backslash', ctrlKey: true });
    expect(await screen.findByRole('dialog', { name: '맥락 패널' })).toBeTruthy();
    expect(useLayoutStore.getState().drawerOpen).toBe(true);
  });

  it('UT-WEB-452 전역 단축키: Mod+K 팔레트·? 도움말·Escape 닫기·G→M /map·G→O 관리 모자+/ops·입력 중 ? 무시 [FR-UX-003]', async () => {
    const app = renderApp('/');
    await screen.findByRole('navigation', { name: '주요 메뉴' });
    press(document.body, { code: 'KeyK', ctrlKey: true });
    expect(usePaletteStore.getState().open).toBe(true);
    press(document.body, { code: 'Slash', shiftKey: true });
    expect(useHotkeysStore.getState().helpOpen).toBe(true);
    press(document.body, { code: 'Escape' });
    expect(usePaletteStore.getState().open).toBe(false);
    expect(useHotkeysStore.getState().helpOpen).toBe(false);

    press(document.body, { code: 'KeyG' });
    press(document.body, { code: 'KeyM' });
    await waitFor(() => expect(app.router.state.location.pathname).toBe('/map'));

    expect(useHatStore.getState().hat).toBe('learn');
    press(document.body, { code: 'KeyG' });
    press(document.body, { code: 'KeyO' });
    await waitFor(() => expect(app.router.state.location.pathname).toBe('/ops'));
    expect(useHatStore.getState().hat).toBe('admin');

    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    press(input, { code: 'Slash', shiftKey: true });
    expect(useHotkeysStore.getState().helpOpen).toBe(false);
    press(input, { code: 'KeyK', ctrlKey: true });
    expect(usePaletteStore.getState().open).toBe(true);
    input.remove();
    // 조합 중에는 무시
    usePaletteStore.setState({ open: false });
    press(document.body, { code: 'KeyK', ctrlKey: true, isComposing: true });
    expect(usePaletteStore.getState().open).toBe(false);
    // 헤더의 팔레트 트리거
    fireEvent.click(screen.getByRole('button', { name: /개념·화면·명령 검색/ }));
    expect(usePaletteStore.getState().open).toBe(true);
    // Mod+Shift+F 집중 모드
    press(document.body, { code: 'KeyF', ctrlKey: true, shiftKey: true });
    expect(useLayoutStore.getState().focusMode).toBe(true);
  });

  it('UT-WEB-455 셸 렌더 시 role=status(polite)·role=alert(assertive) 라이브 리전이 각 1개이고 Toaster가 1개다 [FR-UX-010][NFR-UX-001]', async () => {
    renderApp('/');
    await screen.findByRole('navigation', { name: '주요 메뉴' });
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert').getAttribute('aria-live')).toBe('assertive');
    expect(document.querySelectorAll('section[aria-label^="Notifications"]')).toHaveLength(1);
    expect(document.querySelectorAll('main#main')).toHaveLength(1);
    expect(screen.getByRole('link', { name: '본문으로 건너뛰기' }).getAttribute('href')).toBe('#main');
  });
});
