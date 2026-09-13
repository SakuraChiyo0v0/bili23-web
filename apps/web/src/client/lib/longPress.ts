/**
 * 长按 = 右键（触屏的第二入口）。
 *
 * 手机上已经没有右键了：主要入口是每个行/卡片右上角的「⋯」（触屏常驻），
 * 这里再补一个符合触屏直觉的入口 —— **长按**，与桌面右键打开同一份菜单。
 *
 * 实现要点：
 * - 模块级保存定时器（同一时刻只有一个手势在跑，不需要为每行建 hook —— 循环里也不能用 hook）。
 * - 长按触发后要**吃掉紧随其后的 click**，否则长按还会顺带把这一行勾选/解析掉（很烦人）。
 * - 手指移动（滚动列表）就取消，避免滑动时误触发。
 */
let timer: number | null = null;
/** 长按刚触发过：紧接着的那次 click 要被忽略 */
let swallowClickUntil = 0;

/** 长按阈值：500ms 是移动端常见值（iOS 约 500ms，Android 约 400~500ms） */
const LONG_PRESS_MS = 500;

export function longPressStart(
  e: { touches: ArrayLike<{ clientX: number; clientY: number }> },
  onLongPress: (x: number, y: number) => void,
): void {
  const t = e.touches[0];
  if (!t) return;
  const { clientX: x, clientY: y } = t;
  cancelLongPress();
  timer = window.setTimeout(() => {
    timer = null;
    swallowClickUntil = Date.now() + 700;
    onLongPress(x, y);
  }, LONG_PRESS_MS);
}

export function cancelLongPress(): void {
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
}

/** 长按刚触发过 → 这次 click 不要处理（返回 true 表示应忽略） */
export function shouldSwallowClick(): boolean {
  return Date.now() < swallowClickUntil;
}
