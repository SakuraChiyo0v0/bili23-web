import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { exitMs } from "../components/Overlay";

export type ToastTone = "ok" | "err" | "warn" | "info";
export interface ToastItem {
  id: number;
  msg: string;
  tone: ToastTone;
  /** 长消息（原版 `main_window.py:77-91` 的 showLongMessage）：右下角、纵向、**可关闭**、5 秒、正文最高 200px */
  long?: boolean;
  /** 长消息的第一行（原版长消息是"标题 + 正文"两段） */
  title?: string;
  /** 正在退场（CSS 淡出 + 折叠高度），动画播完才从数组里移除 */
  closing?: boolean;
}

interface ToastCtx {
  toasts: ToastItem[];
  toast: (msg: string, tone?: ToastTone) => void;
  /** 长消息通知：内容较长的提示（启动检查失败、FFmpeg 失败、服务端长错误…） */
  toastLong: (title: string, body: string, tone?: ToastTone) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  /**
   * 退场：先给这条打 `closing`（CSS 里淡出 + 折叠高度，栈里其余的自然往上收），
   * 等动画播完再真正移除。以前是直接 `filter` 掉 —— 元素瞬间消失，观感很硬。
   * 开了「精简动效」时 exitMs 为 0，等价于原来的即时移除。
   */
  const dismiss = useCallback((id: number) => {
    setToasts((cur) => cur.map((t) => (t.id === id ? { ...t, closing: true } : t)));
    window.setTimeout(() => setToasts((cur) => cur.filter((t) => t.id !== id)), exitMs());
  }, []);

  const toast = useCallback(
    (msg: string, tone: ToastTone = "ok") => {
      const id = ++seq.current;
      setToasts((cur) => [...cur.slice(-3), { id, msg, tone }]);
      window.setTimeout(() => dismiss(id), 2600);
    },
    [dismiss],
  );

  const toastLong = useCallback(
    (title: string, body: string, tone: ToastTone = "err") => {
      const id = ++seq.current;
      setToasts((cur) => [...cur.slice(-2), { id, msg: body, tone, long: true, title }]);
      // 原版长消息 5 秒自动消失；但它**可关闭**，所以用户能提前关掉
      window.setTimeout(() => dismiss(id), 5000);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toasts, toast, toastLong }), [toasts, toast, toastLong]);
  const short = toasts.filter((t) => !t.long);
  const long = toasts.filter((t) => t.long);
  return (
    <Ctx.Provider value={value}>
      {children}
      {/* 短提示：顶部居中（原版 InfoBar 形态）；长消息：右下角（原版 showLongMessage 形态） */}
      <div className="toast-root" role="status" aria-live="polite">
        {short.map((t) => (
          <div key={t.id} className={`toast ${t.tone}${t.closing ? " closing" : ""}`}>
            <span className="toast-dot" />
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
      <div className="toast-root long-root" role="status" aria-live="polite">
        {long.map((t) => (
          <div key={t.id} className={`toast long ${t.tone}${t.closing ? " closing" : ""}`}>
            <div className="toast-long-head">
              <span className="toast-dot" />
              <span className="toast-long-title">{t.title}</span>
              <button type="button" className="icon-btn sm" onClick={() => dismiss(t.id)} aria-label="关闭">
                <svg className="ico" viewBox="0 0 24 24" width={14} height={14}><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
            <div className="toast-long-body">{t.msg}</div>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
