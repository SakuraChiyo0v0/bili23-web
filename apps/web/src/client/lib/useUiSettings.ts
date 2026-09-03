import { useCallback, useEffect, useState } from "react";
import { applyMotion, applyTheme, type MotionPreference, type ThemePreference } from "../lib/theme";
import { loadJSON, saveJSON } from "../lib/storage";

export interface UiSettings {
  theme: ThemePreference;
  motion: MotionPreference;
}

export const DEFAULT_UI: UiSettings = { theme: "system", motion: "smooth" };

const THEME_KEY = "ui.theme";
const MOTION_KEY = "ui.motion";

export function useUiSettings(): [UiSettings, (patch: Partial<UiSettings>) => void] {
  const [settings, setSettings] = useState<UiSettings>(() => ({
    theme: loadJSON<ThemePreference>(THEME_KEY, "system"),
    motion: loadJSON<MotionPreference>(MOTION_KEY, "smooth"),
  }));

  // 跟随系统时监听系统主题变化，让“跟随系统”实时生效
  useEffect(() => {
    if (settings.theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [settings.theme]);

  useEffect(() => applyTheme(settings.theme), [settings.theme]);
  useEffect(() => applyMotion(settings.motion), [settings.motion]);

  const update = useCallback((patch: Partial<UiSettings>) => {
    setSettings((prev) => {
      const next: UiSettings = { ...prev, ...patch };
      saveJSON(THEME_KEY, next.theme);
      saveJSON(MOTION_KEY, next.motion);
      return next;
    });
  }, []);

  return [settings, update];
}
