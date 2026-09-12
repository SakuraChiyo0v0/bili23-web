/**
 * 强调色（原版 `E21` ColorDialog / qfluentwidgets 的 `ThemeColor`）—— **DOM/存储那一半**。
 * 纯计算（`accentCss` / `isLight` / `isDefaultAccent`）在 `accentColor.ts`，那边有单测。
 *
 * 原版用系统取色器（含 alpha）；Web 端按对账给的改法：`<input type="color">` + 透明度滑杆，
 * 一起写进 CSS 变量。默认 `#009faa`、不透明（qfluentwidgets 默认，原版没有覆盖它）。
 *
 * 实现要点：把颜色写成 **documentElement 上的内联 CSS 变量** ——
 * 内联样式优先级高于 `:root` 与 `[data-theme=…]` 两个选择器（它们同优先级、靠源码顺序决出胜负），
 * 所以一次设置就能同时覆盖浅色与深色两套令牌，不用分别管理。
 * 代价：深色主题原本更亮的 `--accent`（`#29f1ff`）会被用户色统一覆盖 —— 与原版"一个 ThemeColor 贯穿"一致。
 */
import { DEFAULT_ACCENT, DEFAULT_ACCENT_ALPHA, accentCss, isDefaultAccent, isLight, type AccentPrefs } from "./accentColor";

export { DEFAULT_ACCENT, DEFAULT_ACCENT_ALPHA, accentCss, isDefaultAccent, isLight };
export type { AccentPrefs };

const KEY = "ui.accent";
const KEY_ALPHA = "ui.accent.alpha";

/** 把颜色应用到 CSS 变量；传 undefined 则清除覆盖、回到 tokens.css 的默认 */
export function applyAccent(prefs?: AccentPrefs): void {
  const root = document.documentElement;
  if (!prefs || isDefaultAccent(prefs)) {
    root.style.removeProperty("--accent");
    root.style.removeProperty("--accent-strong");
    root.style.removeProperty("--on-accent");
    return;
  }
  const css = accentCss(prefs.color, prefs.alpha);
  root.style.setProperty("--accent", css);
  // hover 用的亮一档：直接把同一个色给上（原版也是同一 ThemeColor 派生）
  root.style.setProperty("--accent-strong", css);
  // 色块上的文字色要跟着对比度走：亮色底用深字，否则白字看不清。
  // 注意：半透明时实际是叠在背景上的复合色，这里的判断只看 RGB（原版同样只看颜色本身）
  root.style.setProperty("--on-accent", isLight(prefs.color) ? "#000000" : "#ffffff");
}

export function loadAccentPrefs(): AccentPrefs {
  try {
    const color = localStorage.getItem(KEY) ?? DEFAULT_ACCENT;
    const stored = localStorage.getItem(KEY_ALPHA);
    const raw = Number(stored);
    const alpha = stored !== null && Number.isFinite(raw)
      ? Math.min(100, Math.max(0, raw))
      : DEFAULT_ACCENT_ALPHA;
    return { color, alpha };
  } catch {
    return { color: DEFAULT_ACCENT, alpha: DEFAULT_ACCENT_ALPHA };
  }
}

/** 启动时从本地偏好恢复（main.tsx 调一次） */
export function initAccent(): void {
  applyAccent(loadAccentPrefs());
}

/** 保存并应用 */
export function setAccent(color: string, alpha: number): void {
  const prefs: AccentPrefs = { color, alpha: Math.min(100, Math.max(0, Math.round(alpha))) };
  try {
    if (prefs.color.toLowerCase() === DEFAULT_ACCENT) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, prefs.color);
    if (prefs.alpha >= DEFAULT_ACCENT_ALPHA) localStorage.removeItem(KEY_ALPHA);
    else localStorage.setItem(KEY_ALPHA, String(prefs.alpha));
  } catch {
    // 存不下也要让本次生效
  }
  applyAccent(prefs);
}
