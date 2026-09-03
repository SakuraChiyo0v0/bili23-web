import { type ReactNode, useEffect } from "react";

export function Modal({
  open,
  onClose,
  title,
  children,
  /** 手机端使用底部 Sheet 而非居中 */
  sheetOnMobile = true,
  width = "md",
  dismissable = true,
}: {
  open: boolean;
  onClose?: () => void;
  title?: ReactNode;
  children: ReactNode;
  sheetOnMobile?: boolean;
  width?: "sm" | "md" | "lg";
  dismissable?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissable) onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, dismissable, onClose]);

  if (!open) return null;
  return (
    <div
      className={`overlay${sheetOnMobile ? " sheet-on-mobile" : ""}`}
      onMouseDown={(e) => {
        if (dismissable && e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className={`modal ${width}`} role="dialog" aria-modal="true">
        {(title || dismissable) && (
          <div className="modal-head">
            <div className="modal-title">{title}</div>
            {dismissable && (
              <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
                <svg className="ico" viewBox="0 0 24 24" width={18} height={18}>
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            )}
          </div>
        )}
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
