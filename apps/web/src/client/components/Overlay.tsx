import { useEffect, useState, type ReactNode } from "react";

/**
 * 弹窗外壳（遮罩 + 面板 + 进出场动效 + ESC / 点遮罩关闭）。
 *
 * 为什么要统一：原来二十多个弹窗各写一份
 * `<div className="overlay"><div className="modal">`，而 React 在 `open=false` 时直接
 * **unmount** —— 元素一从 DOM 消失，CSS 就没机会播退场动画，所以"关闭"永远是瞬间消失。
 * 这里用一个"延迟卸载"（`closing` 态保持约 150ms）把它做一次，所有弹窗共用。
 *
 * 用法（与原内联写法一一对应）：
 * ```tsx
 * <Overlay open={open} onClose={onClose} size="lg" className="dl-options">…</Overlay>
 * ```
 * `sheetOnMobile` = 窄屏变底部抽屉；`centerOnMobile` = 窄屏也居中（短确认框用）。
 */
export function Overlay({
  open,
  onClose,
  size = "md",
  sheetOnMobile = false,
  centerOnMobile = false,
  className = "",
  dismissable = true,
  children,
}: {
  open: boolean;
  onClose?: () => void;
  size?: "sm" | "md" | "lg";
  sheetOnMobile?: boolean;
  centerOnMobile?: boolean;
  /** 面板附加类名（各弹窗自己的尺寸/专属样式） */
  className?: string;
  dismissable?: boolean;
  children: ReactNode;
}) {
  const [phase, setPhase] = useState<"closed" | "open" | "closing">(open ? "open" : "closed");

  // 外部 open 变化 → 进入 open / 进入 closing（closing 期间仍留在 DOM 里播退场）
  useEffect(() => {
    if (open) { setPhase("open"); return; }
    setPhase((p) => (p === "closed" ? "closed" : "closing"));
  }, [open]);

  // closing → 等退场动画播完再卸载。用户开了"精简动效"就直接卸载，不留"卡住的弹窗"
  useEffect(() => {
    if (phase !== "closing") return;
    const timer = window.setTimeout(() => setPhase("closed"), exitMs());
    return () => window.clearTimeout(timer);
  }, [phase]);

  // ESC 关闭
  useEffect(() => {
    if (phase !== "open" || !dismissable) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, dismissable, onClose]);

  if (phase === "closed") return null;

  return (
    <div
      className={`overlay${sheetOnMobile ? " sheet-on-mobile" : ""}${centerOnMobile ? " center-mobile" : ""}${phase === "closing" ? " closing" : ""}`}
      onMouseDown={(e) => { if (dismissable && e.target === e.currentTarget) onClose?.(); }}
    >
      <div className={`modal ${size}${className ? " " + className : ""}`} role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  );
}

/** 退场时长：与 CSS 里 `.overlay.closing` / `modalOut` 的时长保持一致；精简动效时为 0 */
export function exitMs(): number {
  if (typeof window === "undefined") return 0;
  const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const forcedReduced = document.documentElement.dataset.motion === "reduced";
  return prefersReduced || forcedReduced ? 0 : 150;
}
