import { useEffect, useState } from "react";
import { listDirs } from "../services/client";
import { t as tr } from "../lib/i18n";

/**
 * 服务端目录浏览弹窗 —— 原版各处 `Directory.browse_directory()` 的 Web 对应物。
 *
 * 设置页「下载目录」与下载选项弹窗「下载目录卡」共用同一个组件
 * （原版两处也都是 `DownloadPathSettingCard` 内嵌 `Directory.browse_directory`）。
 */
export function DirPicker({ open, onClose, value, onPick }: { open: boolean; onClose: () => void; value: string; onPick: (dir: string) => void }) {
  const [current, setCurrent] = useState<string>(value || "/");
  const [dirs, setDirs] = useState<Array<{ name: string; path: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [manual, setManual] = useState(value || "");

  useEffect(() => {
    if (!open) return;
    setCurrent(value || "/");
    setManual(value || "");
    setError("");
  }, [open, value]);

  useEffect(() => {
    if (!open || !current) return;
    setLoading(true);
    setError("");
    listDirs(current)
      .then((r) => setDirs(r.dirs))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [open, current]);

  if (!open) return null;

  const up = () => {
    const trimmed = current.replace(/[\\/]+$/, "");
    const idx = trimmed.lastIndexOf("/");
    if (idx > 0) setCurrent(trimmed.slice(0, idx));
    else if (trimmed.length > 0) setCurrent("/");
  };
  const enter = (path: string) => { setCurrent(path); setManual(path); };
  const confirmPick = () => { const dir = manual.trim().replace(/[\\/]+$/, "") || "/"; onPick(dir); onClose(); };

  return (
    <div className="overlay sheet-on-mobile center-mobile" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal md">
        <div className="modal-head">
          <div className="modal-title">{tr("选择下载目录")}</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={tr("关闭")}>
            <svg className="ico" viewBox="0 0 24 24" width={18} height={18}><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="modal-body">
          <div className="dir-picker-current">
            <button type="button" className="btn sm ghost" onClick={up} disabled={current === "/"}>↑ 上级</button>
            <code className="dir-current-path">{current}</code>
          </div>
          <div className="dir-picker-list">
            {loading && <p className="muted small">{tr("加载中…")}</p>}
            {error && <p className="danger small">读取失败：{error}</p>}
            {!loading && !error && dirs.length === 0 && <p className="muted small">{tr("此目录没有可选的子目录")}</p>}
            {dirs.map((d) => (
              <button key={d.path} type="button" className="dir-row" onClick={() => enter(d.path)}>
                <svg className="ico" viewBox="0 0 24 24" width={16} height={16}><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z" /></svg>
                <span>{d.name}</span>
              </button>
            ))}
          </div>
          <div className="dir-picker-tip"><span className="small muted">{tr("点击目录进入子目录，路径会同步到底部输入框。")}</span></div>
        </div>
        <div className="modal-foot">
          <div className="dir-picker-manual">
            <input className="text-input" style={{ flex: 1 }} value={manual} onChange={(e) => setManual(e.target.value)} placeholder={tr("或直接输入 NAS 容器内路径")} />
          </div>
          <div className="right">
            <button type="button" className="btn" onClick={onClose}>{tr("取消")}</button>
            <button type="button" className="btn primary" onClick={confirmPick}>{tr("使用此目录")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
