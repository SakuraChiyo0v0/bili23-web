import { Icon } from "../lib/icons";
import { t as tr } from "../lib/i18n";

/**
 * 通用「说明」弹窗 —— 原版各处 `showGuideMessageBox(title, text)` 的对应物
 *（`gui/component/setting/card.py` 里到处在用，正文是一段带换行的说明）。
 *
 * 正文按 `\n` 分段渲染成多段，避免整块 `<pre>` 在大屏上撑出横向滚动。
 */
export function GuideDialog({ open, title, text, onClose }: {
  open: boolean;
  title: string;
  text: string;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal md" role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className="modal-title">{title}</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={tr("关闭")}><Icon name="x" size={18} /></button>
        </div>
        <div className="modal-body guide-body">
          {text.split("\n").filter((l) => l.trim() !== "").map((para, i) => (
            <p className="small" key={i}>{para}</p>
          ))}
        </div>
        <div className="modal-foot">
          <div className="right"><button type="button" className="btn" onClick={onClose}>{tr("关闭")}</button></div>
        </div>
      </div>
    </div>
  );
}
