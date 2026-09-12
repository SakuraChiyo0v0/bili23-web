import { useEffect, useState } from "react";
import { listVideoParts } from "../services/client";
import type { MediaItem } from "../services/types";
import { useToast } from "../lib/toast";
import { Icon } from "../lib/icons";
import { t as tr, trp } from "../lib/i18n";

/** 时长格式：原版 `Units.format_duration`（分:秒 / 时:分:秒） */
function fmtDuration(sec: number): string {
  if (!sec) return "—";
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * 「分P视频列表」对话框（原版 `gui/dialog/misc/multi_part_lists.py`）。
 *
 * 入口：悬浮命令条「查看分P视频列表」（只有**收藏夹里的分P视频**才启用）。
 * 打开时后台重新解析该稿件的分P 列表 —— **不动主解析树**、也不清缓存
 * （原版 `EpisodeData.parsing(clear_cache=False)`）。
 *
 * 文案逐字对齐：标题「分P视频列表」/ 全选 / 「已选择 N 项，共 M 项」或「共 M 项」/
 * 「下载所选项目」（无勾选时禁用）；表头 序号 / 标题 / 时长（90/300/100）。
 */
export function MultiPartListsDialog({ open, onClose, item, onDownload }: {
  open: boolean;
  onClose: () => void;
  /** 触发的那个条目（收藏夹里的分P视频） */
  item?: MediaItem | null;
  /** 确认：把勾选的分P 交给下载流程（原版 `signal_bus.download.create_task`） */
  onDownload: (items: MediaItem[]) => void;
}) {
  const { toast } = useToast();
  const [parts, setParts] = useState<MediaItem[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !item) return;
    setParts([]);
    setChecked(new Set());
    setError("");
    setLoading(true);
    listVideoParts(item.url ?? "")
      .then((r) => setParts(r.items))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [open, item]);

  if (!open || !item) return null;

  const total = parts.length;
  const selected = checked.size;
  const allChecked = total > 0 && selected === total;
  const toggle = (id: string) => setChecked((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  return (
    <div className="overlay sheet-on-mobile center-mobile" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal lg" role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className="modal-title">{tr("分P视频列表")}</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={tr("关闭")}><Icon name="x" size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="mp-list-head">
            <label className="check-row" style={{ padding: 0 }}>
              <input type="checkbox" checked={allChecked}
                onChange={(e) => setChecked(e.target.checked ? new Set(parts.map((p) => p.id)) : new Set())} />
              <span>{tr("全选")}</span>
            </label>
            <span className="muted small" style={{ marginLeft: 10 }}>
              {selected > 0
                ? trp("已选择 {selected_count} 项，共 {total_count} 项", { selected_count: selected, total_count: total })
                : trp("共 {total_count} 项", { total_count: total })}
            </span>
          </div>
          {loading && <div className="empty-state"><span className="spinner" /><p>正在解析分P 列表…</p></div>}
          {error && <p className="danger small">解析失败：{error}</p>}
          {!loading && !error && (
            <div className="mp-list">
              <div className="mp-row mp-head">
                <span className="mp-check" />
                <span>{tr("序号")}</span>
                <span>{tr("标题")}</span>
                <span>{tr("时长")}</span>
              </div>
              {parts.length === 0 && <p className="muted small" style={{ padding: "10px 12px" }}>{tr("该稿件没有分P")}</p>}
              {parts.map((p, i) => (
                <label key={p.id} className="mp-row">
                  <span className="mp-check">
                    <input type="checkbox" checked={checked.has(p.id)} onChange={() => toggle(p.id)} />
                  </span>
                  <span className="mp-no">{i + 1}</span>
                  <span className="mp-title" title={p.title}>{p.title}</span>
                  <span className="mp-dur muted">{fmtDuration(p.duration)}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="modal-foot">
          <div className="right">
            <button type="button" className="btn" onClick={onClose}>{tr("取消")}</button>
            <button type="button" className="btn primary" disabled={selected === 0}
              onClick={() => {
                const picked = parts.filter((p) => checked.has(p.id));
                if (picked.length === 0) { toast(tr("请先勾选要下载的分P"), "warn"); return; }
                onDownload(picked);
              }}>{tr("下载所选项目")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
