import { create, type StoreApi, type UseBoundStore } from 'zustand';

export interface HotkeysState {
  helpOpen: boolean;
  openHelp: () => void;
  closeHelp: () => void;
}

/** 단축키 도움말(`?`) 열림 상태. */
export function createHotkeysStore(): UseBoundStore<StoreApi<HotkeysState>> {
  return create<HotkeysState>()((set) => ({
    helpOpen: false,
    openHelp: () => set({ helpOpen: true }),
    closeHelp: () => set({ helpOpen: false }),
  }));
}

export const useHotkeysStore: UseBoundStore<StoreApi<HotkeysState>> = createHotkeysStore();
