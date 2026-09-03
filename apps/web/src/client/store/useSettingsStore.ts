import { create } from "zustand";
import type { AppConfig, AppConfigPatch } from "../services/types";
import { getConfig, updateConfig } from "../services/client";

interface SettingsState {
  config?: AppConfig;
  loading: boolean;
  saved: boolean;
  error?: string;
  load: () => Promise<void>;
  save: (patch: AppConfigPatch) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  config: undefined,
  loading: false,
  saved: false,
  error: undefined,
  load: async () => {
    set({ loading: true, error: undefined });
    try {
      const { config } = await getConfig();
      set({ config, loading: false });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), loading: false });
    }
  },
  save: async (patch) => {
    set({ saved: false, error: undefined });
    try {
      const { config } = await updateConfig(patch);
      set({ config, saved: true });
      // 3s 后重置 saved 提示
      setTimeout(() => set({ saved: false }), 3000);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },
}));

export type ThemeOption = "light" | "dark" | "system";
export const THEME_LABELS: Record<string, string> = { light: "浅色", dark: "深色", system: "跟随系统" };
export const LANG_LABELS: Record<string, string> = { "zh-CN": "简体中文", "zh-TW": "繁體中文", en: "English", system: "系统默认" };
export const CONTAINER_LABELS: Record<string, string> = { mp4: "MP4", mkv: "MKV" };
export const RENAME_LABELS: Record<string, string> = { auto: "自动重命名", overwrite: "覆盖" };
export const DUP_LABELS: Record<string, string> = { prompt: "总是询问", skip: "跳过", force: "强制下载" };