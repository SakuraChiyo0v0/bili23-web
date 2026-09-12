/**
 * 通用确认/提示框 —— 原版到处都是的 qfluentwidgets `MessageBox`。
 *
 * 两种用法（对齐原版语义）：
 * - `cancelText` 给了 → 确定/取消**二选一**，取消表示"不继续"（原版 `accept()` 里 `return dialog.exec()`，
 *   取消时调用方直接 return、弹窗保持打开）；
 * - `cancelText` 不给 → **只有确定**（原版 `dialog.hideCancelButton()`）。
 */
export function ConfirmDialog({ open, title, body, confirmText = "确定", cancelText, onConfirm, onCancel }: {
  open: boolean;
  title: string;
  /** 正文：`\n\n` 分段（原版 MessageBox 就是这么排的） */
  body: string;
  confirmText?: string;
  /** 不给就是"仅提示"（原版隐藏取消按钮） */
  cancelText?: string;
  onConfirm: () => void;
  onCancel?: () => void;
}) {
  if (!open) return null;
  const close = onCancel ?? onConfirm;
  return (
    <div className="overlay sheet-on-mobile center-mobile" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal sm" role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className="modal-title">{title}</div>
        </div>
        <div className="modal-body">
          {body.split("\n\n").map((para, i) => (
            <p className="small" key={i} style={{ marginTop: i === 0 ? 0 : 8 }}>{para}</p>
          ))}
        </div>
        <div className="modal-foot">
          <div className="right">
            {cancelText ? <button type="button" className="btn" onClick={close}>{cancelText}</button> : null}
            <button type="button" className="btn primary" onClick={onConfirm} autoFocus>{confirmText}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
