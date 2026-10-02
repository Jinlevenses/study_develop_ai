import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createHatStore } from '../../../src/stores/hat.js';
import { createHotkeysStore } from '../../../src/stores/hotkeys.js';
import { contextPrefKey, createLayoutStore, resolveContextOpen } from '../../../src/stores/layout.js';
import { createPaletteStore } from '../../../src/stores/palette.js';
import { createPlayerStore } from '../../../src/stores/player.js';
import { renderApp } from './support/harness.js';

function memoryStorage(initial: Record<string, string> = {}): Storage {
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

describe('stores', () => {
  it('UT-WEB-456 스토어 5종은 초기 상태·액션이 정해진 대로 동작하고 팩토리 인스턴스끼리 격리된다 [STD-WEB-11]', () => {
    const storage = memoryStorage({ 'fathom.hat': 'admin' });
    const hat = createHatStore(storage);
    expect(hat.getState().hat).toBe('admin');
    hat.getState().setHat('learn');
    expect(hat.getState().hat).toBe('learn');
    expect(storage.getItem('fathom.hat')).toBe('learn');
    expect(createHatStore(memoryStorage()).getState().hat).toBe('learn');
    expect(createHatStore(memoryStorage({ 'fathom.hat': 'bogus' })).getState().hat).toBe('learn');

    const palette = createPaletteStore();
    expect(palette.getState()).toMatchObject({ open: false, query: '' });
    palette.getState().openPalette();
    palette.getState().setQuery('ㄷㅋ');
    expect(palette.getState()).toMatchObject({ open: true, query: 'ㄷㅋ' });
    palette.getState().closePalette();
    expect(palette.getState()).toMatchObject({ open: false, query: '' });
    expect(createPaletteStore().getState().open).toBe(false);

    const hotkeys = createHotkeysStore();
    expect(hotkeys.getState().helpOpen).toBe(false);
    hotkeys.getState().openHelp();
    expect(hotkeys.getState().helpOpen).toBe(true);
    hotkeys.getState().closeHelp();
    expect(hotkeys.getState().helpOpen).toBe(false);

    const player = createPlayerStore();
    expect(player.getState()).toMatchObject({ timerEnabled: true, timerScale: 1 });
    player.getState().setTimerEnabled(false);
    player.getState().setTimerScale(1.5);
    expect(player.getState()).toMatchObject({ timerEnabled: false, timerScale: 1.5 });
    player.getState().setTimerScale(2);
    expect(player.getState().timerScale).toBe(2);
    expect(createPlayerStore().getState().timerEnabled).toBe(true);

    const layoutStorage = memoryStorage({ [contextPrefKey('/inbox')]: '0' });
    const layout = createLayoutStore(layoutStorage);
    expect(layout.getState()).toMatchObject({ contextOpen: {}, focusMode: false, drawerOpen: false });
    expect(resolveContextOpen(layout.getState().contextOpen, '/map', layoutStorage)).toBe(true);
    expect(resolveContextOpen(layout.getState().contextOpen, '/inbox', layoutStorage)).toBe(false);
    layout.getState().toggleContext('/map');
    expect(layout.getState().contextOpen).toEqual({ '/map': false });
    expect(layoutStorage.getItem('fathom.ctx./map')).toBe('0');
    layout.getState().toggleContext('/map');
    expect(layoutStorage.getItem('fathom.ctx./map')).toBe('1');
    layout.getState().toggleContext('/inbox'); // 저장값(0) → 열림
    expect(layout.getState().contextOpen['/inbox']).toBe(true);
    layout.getState().toggleFocus();
    expect(layout.getState().focusMode).toBe(true);
    layout.getState().toggleDrawer();
    expect(layout.getState().drawerOpen).toBe(true);
    layout.getState().closeDrawer();
    expect(layout.getState().drawerOpen).toBe(false);
    expect(createLayoutStore(memoryStorage()).getState().contextOpen).toEqual({});
  });

  it('UT-WEB-457 RouteStub는 SCR 문구를 보이고 404는 홈으로 행동 1개이며 <p>에 작은 글자 클래스가 0이다 [FR-UX-011][NFR-UX-009]', async () => {
    const app = renderApp('/map');
    await screen.findByText('SCR-04 · 이 화면은 다음 반복에서 채워집니다.');
    const main = document.querySelector('main#main');
    expect(main?.querySelectorAll('button')).toHaveLength(0); // 행동 강제 0
    for (const p of document.querySelectorAll('p')) {
      expect(p.className, p.textContent ?? '').not.toMatch(/\btext-(xs|sm|2xs)\b/);
    }
    expect(main?.textContent).not.toMatch(/실패|게으름|연체|밀린|놓쳤|스트릭이 끊|잃게 됩니다|XP|코인|레벨업!|랭킹/);
    app.utils.unmount();

    const nope = renderApp('/없는/경로');
    await screen.findByText('페이지를 찾을 수 없습니다');
    const mainNope = document.querySelector('main#main');
    const actions = mainNope?.querySelectorAll('button') ?? [];
    expect([...actions].map((b) => b.textContent)).toEqual(['홈으로']);
    (actions[0] as HTMLButtonElement).click();
    await screen.findByText('SCR-01 · 이 화면은 다음 반복에서 채워집니다.');
    expect(nope.router.state.location.pathname).toBe('/');
  });
});
