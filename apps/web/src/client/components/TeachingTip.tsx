import { useLayoutEffect, useState, type ReactNode } from "react";
import { Icon } from "../lib/icons";
import { t as tr } from "../lib/i18n";

/** 气泡尾巴指向哪一边（= 气泡本体在目标的反方向） */
export type TeachingTipTail = "bottom" | "left" | "top";

/**
 * 教学气泡（原版 qfluentwidgets `TeachingTip`）。
 *
 * 原版是锚在某个控件旁边的一次性提示；Web 端用 `position:fixed` + 目标
 * `getBoundingClientRect()` 复刻同一效果（窗口尺寸/滚动时重新定位）。
 * `isClosable` 对应右上角的关闭按钮；`duration=-1` 表示不自动消失。
 */
export function TeachingTip({ open, target, title, content, tail = "bottom", onClose, children }: {
  open: boolean;
  /** 锚点元素（拿不到就不显示——原版 target 被销毁时提示也会消失） */
  target: HTMLElement | null;
  title: string;
  content: ReactNode;
  tail?: TeachingTipTail;
  onClose: () => void;
  /** 气泡内的额外内容（如「知道了」按钮） */
  children?: ReactNode;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !target) { setPos(null); return; }
    const place = () => {
      const r = target.getBoundingClientRect();
      const GAP = 12;
      if (tail === "left") setPos({ top: r.top + r.height / 2, left: r.right + GAP });
      else if (tail === "top") setPos({ top: r.top - GAP, left: r.left });
      else setPos({ top: r.bottom + GAP + 8, left: r.left });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, target, tail]);

  if (!open || !target || !pos) return null;

  // 气泡高度未知，用 transform 做对齐：left 尾 → 垂直居中于目标；top 尾 → 底部对齐目标上沿；bottom 尾 → 顶部对齐目标下沿
  const transform =
    tail === "left" ? "translateY(-50%)" : tail === "top" ? "translateY(-100%)" : "none";

  return (
    <div className={`teaching-tip tail-${tail}`} style={{ top: pos.top, left: pos.left, transform }} role="dialog">
      <div className="teaching-tip-head">
        <span className="teaching-tip-title">{title}</span>
        <button type="button" className="icon-btn sm" onClick={onClose} aria-label={tr("关闭")}><Icon name="x" size={14} /></button>
      </div>
      <div className="teaching-tip-body">{content}</div>
      {children ? <div className="teaching-tip-foot">{children}</div> : null}
    </div>
  );
}
