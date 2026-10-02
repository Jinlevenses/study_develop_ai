import { create, type StoreApi, type UseBoundStore } from 'zustand';

export type TimerScale = 1 | 1.5 | 2;

export interface PlayerState {
  timerEnabled: boolean;
  timerScale: TimerScale;
  setTimerEnabled: (enabled: boolean) => void;
  setTimerScale: (scale: TimerScale) => void;
}

/** 플레이어 휘발 상태 — 타이머 끄기·연장(WCAG 2.2.1). 플레이어 WP가 확장한다. */
export function createPlayerStore(): UseBoundStore<StoreApi<PlayerState>> {
  return create<PlayerState>()((set) => ({
    timerEnabled: true,
    timerScale: 1,
    setTimerEnabled: (timerEnabled) => set({ timerEnabled }),
    setTimerScale: (timerScale) => set({ timerScale }),
  }));
}

export const usePlayerStore: UseBoundStore<StoreApi<PlayerState>> = createPlayerStore();
