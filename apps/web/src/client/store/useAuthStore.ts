import { create } from "zustand";
import { authStatus } from "../services/client";

interface AuthState {
  loggedIn: boolean;
  preview: string;
  uname?: string;
  face?: string;
  mid?: number;
  checked: boolean;
  refresh: () => Promise<void>;
  set: (st: { loggedIn: boolean; preview: string; uname?: string; face?: string; mid?: number }) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  loggedIn: false,
  preview: "",
  uname: undefined,
  face: undefined,
  mid: undefined,
  checked: false,
  refresh: async () => {
    try {
      const { loggedIn, preview, uname, face, mid } = await authStatus();
      set({ loggedIn, preview, uname, face, mid, checked: true });
    } catch {
      set({ checked: true });
    }
  },
  set: (st) => set({ ...st, checked: true }),
}));