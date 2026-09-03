export type ThemePreference = "light" | "dark" | "system";
export type MotionPreference = "smooth" | "reduced";

/** 与后端 behavior.theme 一致的主题枚举 */
export function applyTheme(pref: ThemePreference): void {
  const dark =
    pref === "dark" ||
    (pref === "system" && typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export function applyMotion(pref: MotionPreference): void {
  document.documentElement.dataset.motion = pref;
}
