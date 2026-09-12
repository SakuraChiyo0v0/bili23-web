/**
 * 动效相关的小工具。
 *
 * 单独放一个模块是为了**依赖方向**：`lib/toast.tsx` 也需要"退场时长"这个判断，
 * 而 lib 不该反过来 import components（之前 toast 从 `components/Overlay` 引 exitMs，是个坏方向）。
 */

/** 退场动画时长（与 CSS 里 `.overlay.closing` / `modalOut` / `.toast.closing` 的时长保持一致） */
export const MOTION_EXIT_MS = 150;

/**
 * 当前该等多久再卸载"正在退场"的元素：
 * 用户选了「精简动效」（`html[data-motion=reduced]`）或系统 `prefers-reduced-motion` 时为 0，
 * 此时等价于"即时移除"，不会留一个卡在半路的弹窗/提示。
 */
export function exitMs(): number {
  if (typeof window === "undefined") return 0;
  const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const forcedReduced = document.documentElement.dataset.motion === "reduced";
  return prefersReduced || forcedReduced ? 0 : MOTION_EXIT_MS;
}
