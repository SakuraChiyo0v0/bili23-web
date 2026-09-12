import { useState } from "react";
import { Icon } from "../lib/icons";
import { t as tr } from "../lib/i18n";
import { Overlay } from "./Overlay";

/**
 * 「选择地理位置」弹窗 —— 对齐原版 `gui/dialog/setting/select_area.py`：
 * 说明「请选择你的实际所在地，程序会据此自动匹配更合适的 CDN 服务器，以提升下载速度。」
 * + 提示「提示：如果正在使用代理，请选择代理服务器所在区域。」
 * + 两个单选：中国大陆 / 中国大陆以外地区（包括香港、澳门和台湾）。
 *
 * 原版在首次启动时会自动弹一次（`main_window.py:31-34`，用 `select_area_dialog_shown` 记账）。
 * Web 端不做"首次弹窗"，只在设置里提供入口 —— 服务端没有"已展示过"这个状态，
 * 为此单独加一个字段只为弹一次窗，代价不值。
 */
export function AreaDialog({
  open, value, onClose, onConfirm,
}: {
  open: boolean;
  value: "cn" | "ov";
  onClose: () => void;
  onConfirm: (next: "cn" | "ov") => void;
}) {
  const [choice, setChoice] = useState<"cn" | "ov">(value);
  const option = (v: "cn" | "ov", label: string) => (
    <label className="radio-row">
      <input type="radio" name="area" checked={choice === v} onChange={() => setChoice(v)} />
      <span>{label}</span>
    </label>
  );

  return (
    <Overlay open={open} onClose={onClose} size="sm">
        <div className="modal-head">
          <div className="modal-title">{tr("选择地理位置")}</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={tr("关闭")}><Icon name="x" size={18} /></button>
        </div>
        <div className="modal-body">
          <p className="small">请选择你的实际所在地，程序会据此自动匹配更合适的 CDN 服务器，以提升下载速度。</p>
          <p className="small muted">{tr("提示：如果正在使用代理，请选择代理服务器所在区域。")}</p>
          <div className="radio-list">
            {option("cn", "中国大陆")}
            {option("ov", "中国大陆以外地区（包括香港、澳门和台湾）")}
          </div>
        </div>
        <div className="modal-foot">
          <div className="right">
            <button type="button" className="btn" onClick={onClose}>{tr("取消")}</button>
            <button type="button" className="btn primary" onClick={() => onConfirm(choice)}>{tr("确定")}</button>
          </div>
        </div>
      </Overlay>
  );
}
