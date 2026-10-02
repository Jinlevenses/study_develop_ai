import { create, type StoreApi, type UseBoundStore } from 'zustand';

export interface PaletteState {
  open: boolean;
  query: string;
  openPalette: () => void;
  closePalette: () => void;
  setQuery: (query: string) => void;
}

/** 명령 팔레트 열림·질의 — 팔레트 UI 자체는 GLB-PAL WP. */
export function createPaletteStore(): UseBoundStore<StoreApi<PaletteState>> {
  return create<PaletteState>()((set) => ({
    open: false,
    query: '',
    openPalette: () => set({ open: true }),
    closePalette: () => set({ open: false, query: '' }),
    setQuery: (query) => set({ query }),
  }));
}

export const usePaletteStore: UseBoundStore<StoreApi<PaletteState>> = createPaletteStore();
