import { create } from "zustand";
import { authStatus } from "../services/client";

interface AuthState {
  loggedIn: boolean;
  preview: string;
  checked: boolean;
  refresh: () => Promise<void>;
  set: (loggedIn: boolean, preview: string) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  loggedIn: false,
  preview: "",
  checked: false,
  refresh: async () => {
    try {
      const { loggedIn, preview } = await authStatus();
      set({ loggedIn, preview, checked: true });
    } catch {
      set({ checked: true });
    }
  },
  set: (loggedIn, preview) => set({ loggedIn, preview, checked: true }),
}));