import { t as tr } from "../lib/i18n";
/**
 * 「互动视频」确认对话框（原版 `gui/dialog/misc/interactive_video.py`）。
 *
 * 桌面两段式解析：第一段只拉 `view` 接口，命中 `rights.is_stein_gate === 1`
 * 就弹这个框；用户确认后再走 INTERACTIVE_VIDEO 解析器 BFS 展开全部分支节点
 * （`parser/video.py:265-268` → `parse.py:181-188`）。
 *
 * 原版唯一的选项「自动解析所有节点」是默认选中且**唯一**的项；
 * 源码里那个「不再询问」复选框被注释掉了，属附录 B 废弃项，这里也不做。
 */
export function InteractiveVideoDialog({ open, title, onCancel, onConfirm }: {
  open: boolean;
  /** 命中互动视频的稿件标题（原版把 info_data 也带进对话框，仅用于日志） */
  title?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  return (
    <div className="overlay sheet-on-mobile center-mobile" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="modal sm" role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className="modal-title">{tr("互动视频")}</div>
          <button type="button" className="icon-btn" onClick={onCancel} aria-label={tr("关闭")}>
            <svg className="ico" viewBox="0 0 24 24" width={18} height={18}><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="modal-body">
          <p className="muted small">{tr("检测到互动视频，请选择操作")}</p>
          <label className="radio-row">
            <input type="radio" name="interactive-action" checked readOnly />
            <span>{tr("自动解析所有节点")}</span>
          </label>
          {title ? <p className="muted small" style={{ marginTop: 6 }}>{title}</p> : null}
        </div>
        <div className="modal-foot">
          <div className="right">
            <button type="button" className="btn" onClick={onCancel}>{tr("取消")}</button>
            <button type="button" className="btn primary" onClick={onConfirm}>{tr("确定")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
