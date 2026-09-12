import { useEffect, useRef, useState, type ReactNode } from "react";
import { exitMs } from "../lib/motion";

/**
 * 弹窗外壳（遮罩 + 面板 + 进出场动效 + ESC / 点遮罩关闭 + 焦点管理）。
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
 *
 * ⚠️ 父组件**不要**用 `{flag && <Overlay …>}` 门控挂载 —— 那样关闭时还是"瞬间消失"，
 * 退场动画白做。要传 `open={flag}`，让 Overlay 自己管卸载。
 */

/** 当前挂在屏幕上的弹窗栈：ESC 只让**最上面**那个响应（嵌套弹窗很常见：下载选项里套确认框） */
const openStack: symbol[] = [];

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
  /** false = 不响应 ESC / 点遮罩（用于"必须点按钮"的确认框） */
  dismissable?: boolean;
  children: ReactNode;
}) {
  const [phase, setPhase] = useState<"closed" | "open" | "closing">(open ? "open" : "closed");
  const panelRef = useRef<HTMLDivElement | null>(null);
  /** 打开前焦点在哪，关掉之后还回去（键盘用户不会"迷失在页面顶部"） */
  const restoreFocusRef = useRef<HTMLElement | null>(null);

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

  // ESC 关闭（只有栈顶响应）
  useEffect(() => {
    if (phase !== "open") return;
    const token = Symbol("overlay");
    openStack.push(token);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (openStack[openStack.length - 1] !== token) return;
      if (!dismissable) return;
      onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const i = openStack.indexOf(token);
      if (i >= 0) openStack.splice(i, 1);
    };
  }, [phase, dismissable, onClose]);

  // 打开时把焦点移进面板、关闭后还回原处；Tab 在面板内循环（不会跑到下面的页面里）
  useEffect(() => {
    if (phase !== "open") return;
    restoreFocusRef.current = (document.activeElement as HTMLElement | null) ?? null;
    panelRef.current?.focus();
    return () => { restoreFocusRef.current?.focus?.(); };
  }, [phase]);

  const onPanelKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = panel.querySelectorAll<HTMLElement>(
      'a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])',
    );
    if (focusables.length === 0) return;
    const first = focusables[0] as HTMLElement;
    const last = focusables[focusables.length - 1] as HTMLElement;
    const active = document.activeElement;
    if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  };

  if (phase === "closed") return null;

  return (
    <div
      className={`overlay${sheetOnMobile ? " sheet-on-mobile" : ""}${centerOnMobile ? " center-mobile" : ""}${phase === "closing" ? " closing" : ""}`}
      onMouseDown={(e) => { if (dismissable && e.target === e.currentTarget) onClose?.(); }}
    >
      <div
        ref={panelRef}
        className={`modal ${size}${className ? " " + className : ""}`}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onKeyDown={onPanelKeyDown}
      >
        {children}
      </div>
    </div>
  );
}
