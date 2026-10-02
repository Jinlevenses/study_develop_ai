import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { readPref, writePref } from '../lib/ui-prefs.js';

export type Hat = 'learn' | 'admin';

export interface HatState {
  hat: Hat;
  setHat: (hat: Hat) => void;
}

/** 모자(학습·관리) — 초기값·저장은 ui-prefs `fathom.hat`. 테스트는 팩토리로 격리한다. */
export function createHatStore(storage?: Storage | null): UseBoundStore<StoreApi<HatState>> {
  return create<HatState>()((set) => ({
    hat: readPref('fathom.hat', storage) === 'admin' ? 'admin' : 'learn',
    setHat: (hat) => {
      writePref('fathom.hat', hat, storage);
      set({ hat });
    },
  }));
}

export const useHatStore: UseBoundStore<StoreApi<HatState>> = createHatStore();
