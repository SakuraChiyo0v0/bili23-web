import { useEffect, useState } from "react";
import { Icon } from "../lib/icons";
import { t as tr } from "../lib/i18n";

/**
 * 「自定义 User-Agent」弹窗 —— 对齐原版 `gui/dialog/setting/user_agent.py`：
 * 一个输入框（占位「请输入 User-Agent」）+ 清空按钮，**空值直接拦**（原版把输入框标红并聚焦，
 * 我们这里用按钮禁用 + 错误文案表达同一件事）。
 */
export function UserAgentDialog({
  open, value, onClose, onConfirm,
}: {
  open: boolean;
  value: string;
  onClose: () => void;
  onConfirm: (next: string) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => { if (open) setText(value); }, [open, value]);
  if (!open) return null;

  const empty = text.trim() === "";
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal md" role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className="modal-title">自定义 User-Agent</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={tr("关闭")}><Icon name="x" size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="dl-field">
            <input className={`text-input${empty ? " invalid" : ""}`} style={{ flex: 1 }} placeholder={tr("请输入 User-Agent")}
              value={text} autoFocus onChange={(e) => setText(e.target.value)} />
            {text && <button type="button" className="icon-btn sm" onClick={() => setText("")} aria-label={tr("清空")}><Icon name="x" size={15} /></button>}
          </div>
          {empty && <p className="small danger" style={{ marginTop: 6 }}>User-Agent 不能为空</p>}
        </div>
        <div className="modal-foot">
          <div className="right">
            <button type="button" className="btn" onClick={onClose}>{tr("取消")}</button>
            <button type="button" className="btn primary" disabled={empty} onClick={() => onConfirm(text.trim())}>{tr("确定")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
