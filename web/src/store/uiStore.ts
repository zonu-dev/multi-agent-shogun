import { create } from 'zustand';

export interface ActivePopupState {
  type: string;
  data?: unknown;
}

export interface UIStoreState {
  selectedAshigaru: string | null;
  activePopup: ActivePopupState | null;
  selectAshigaru: (id: string | null) => void;
  openPopup: (type: string, data?: unknown) => void;
  closePopup: () => void;
}

export const useUIStore = create<UIStoreState>((set) => ({
  selectedAshigaru: null,
  activePopup: null,
  selectAshigaru: (id) => set({ selectedAshigaru: id }),
  openPopup: (type, data) =>
    set({
      activePopup: {
        type,
        data,
      },
    }),
  closePopup: () => set({ activePopup: null }),
}));
