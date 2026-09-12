/**
 * 强调色的**纯计算**部分（不碰 DOM / localStorage）。
 *
 * 单独拆一个文件的原因很具体：这些函数要有单测，而 `apps/web/tests/` 同时被
 * **服务端 tsconfig**（`tsconfig.json`，lib 里没有 DOM）编译 —— 一旦测试 import 了
 * 带 `document` 的 `accent.ts`，就会报 `Cannot find name 'document'`。
 * 所以把"能纯算"的放这里，把"要写 DOM"的留在 `accent.ts`。
 *
 * 原版对应 `E21`：系统取色器 ColorDialog，**含 alpha 滑杆**。
 */
export const DEFAULT_ACCENT = "#009faa";
export const DEFAULT_ACCENT_ALPHA = 100;

export interface AccentPrefs {
  /** `#RRGGBB` */
  color: string;
  /** 0–100（原版取色器的 alpha 是 0–255，这里用百分比更直观） */
  alpha: number;
}

/**
 * 把颜色 + 透明度拼成 CSS 颜色值。
 * alpha=100 仍返回 `#RRGGBB`（与 tokens.css 里的写法一致、便于人读），
 * 否则返回 `rgba(r, g, b, a)`。
 */
export function accentCss(color: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  const a = Math.min(100, Math.max(0, Math.round(alpha)));
  if (!m || a >= 100) return color;
  const n = parseInt(m[1]!, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${(a / 100).toFixed(2)})`;
}

/** 粗判亮度（sRGB 加权）：只用于选黑/白字，不追求色彩学精确 */
export function isLight(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return false;
  const n = parseInt(m[1]!, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150;
}

/** 是否是"没改过"的默认（用来决定要不要清掉内联变量、回落到 tokens.css） */
export function isDefaultAccent(prefs: AccentPrefs): boolean {
  return prefs.color.toLowerCase() === DEFAULT_ACCENT && prefs.alpha >= DEFAULT_ACCENT_ALPHA;
}
