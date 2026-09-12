import { useCallback, useEffect, useState } from "react";
import { listLogs, clearLogs } from "../services/client";
import type { LogEntry } from "../services/types";
import { Icon } from "../lib/icons";
import { Overlay } from "./Overlay";
import { t as tr } from "../lib/i18n";

/**
 * 日志窗口 —— 对齐原版 `gui/dialog/log.py`（独立非模态窗口，最小 800×520）：
 * 搜索框（占位「搜索日志...」）+ 工具条（刷新 / 清除日志）+ 提示
 * 「提示：点击日志条目查看详情，右键点击复制」+ 列表（空态「暂无日志」）
 * + 点击/右键出「日志详情」，正文模板与桌面一致。
 *
 * 两处如实记的差异：
 * - 桌面工具条还有「打开日志目录」—— 浏览器没有等价物，**不做假按钮**
 * - 桌面行高 100px（一条一块），Web 用紧凑两行；设计稿允许这类差异
 */
export function LogViewerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<LogEntry | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; entry: LogEntry } | null>(null);
  const [toast, setToast] = useState("");

  const load = useCallback(async (kw: string) => {
    setLoading(true); setError("");
    try {
      const r = await listLogs({ search: kw, limit: 1000 });
      setEntries(r.entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (open) void load(""); }, [open, load]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 1500);
    return () => clearTimeout(t);
  }, [toast]);

  /** 详情正文 —— 与桌面 `Log Details` 的模板逐行一致 */
  const detailText = (e: LogEntry) =>
    `Timestamp: ${e.timestamp}\nLevel: ${e.level}\nName: ${e.name} (${e.callsite})\n\nMessage:\n${e.message}`;

  const doClear = async () => {
    try {
      await clearLogs();
      setEntries([]);
      setToast("日志已清除");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const levelClass = (level: string) =>
    level === "ERROR" || level === "CRITICAL" ? "err" : level === "WARNING" ? "warn" : "info";

  return (
    <>
      <Overlay open={open} onClose={onClose} size="lg">
          <div className="modal-head">
            <div className="modal-title">{tr("日志")}</div>
            <div className="spacer" />
            <button type="button" className="btn sm" onClick={() => void load(search)} disabled={loading}>{loading ? tr("刷新中…") : tr("刷新")}</button>
            <button type="button" className="btn sm ghost" onClick={() => void doClear()} disabled={entries.length === 0}>{tr("清除日志")}</button>
            <button type="button" className="icon-btn" onClick={onClose} aria-label={tr("关闭")}><Icon name="x" size={18} /></button>
          </div>
          <div className="modal-body log-viewer">
            <div className="tree-search">
              <Icon name="search" size={16} />
              <input className="text-input" placeholder={tr("搜索日志...")} value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void load(search); }} />
              {search && <button type="button" className="btn sm ghost" onClick={() => { setSearch(""); void load(""); }}>{tr("清除")}</button>}
            </div>
            <p className="small muted">{tr("提示：点击日志条目查看详情，右键点击复制")}</p>
            {error ? (
              <div className="empty-state"><p className="muted">读取日志失败：{error}</p></div>
            ) : entries.length === 0 ? (
              <div className="empty-state"><h3>{tr("暂无日志")}</h3></div>
            ) : (
              <div className="log-list">
                {entries.map((e, i) => (
                  <div key={`${e.timestamp}-${i}`} className="log-row"
                    onClick={() => setDetail(e)}
                    onContextMenu={(ev) => { ev.preventDefault(); setMenu({ x: ev.clientX, y: ev.clientY, entry: e }); }}>
                    <div className="log-row-head">
                      <span className={`log-level ${levelClass(e.level)}`}>{e.level}</span>
                      <span className="log-time">{e.timestamp}</span>
                      <span className="log-name">{e.name}</span>
                    </div>
                    <div className="log-msg" title={e.message}>{e.message}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
      </Overlay>

      {/* 日志详情（桌面 `Log Details`）—— 叠在日志之上，同样走 Overlay */}
      <Overlay open={detail !== null} onClose={() => setDetail(null)} size="md">
        <div className="modal-head">
          <div className="modal-title">{tr("日志详情")}</div>
          <button type="button" className="icon-btn" onClick={() => setDetail(null)} aria-label={tr("关闭")}><Icon name="x" size={18} /></button>
        </div>
        <div className="modal-body"><pre className="meta-pre">{detail ? detailText(detail) : ""}</pre></div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={() => { if (detail) void navigator.clipboard?.writeText(detailText(detail)); setToast("已复制"); }}>{tr("复制")}</button>
          <div className="right"><button type="button" className="btn" onClick={() => setDetail(null)}>{tr("关闭")}</button></div>
        </div>
      </Overlay>

      {/* 右键菜单：查看详情 / 复制（桌面就是这样两项） */}
      {menu && (
        <div className="ctx-layer" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }}>
          <div className="ctx-menu" style={{ left: Math.min(menu.x, window.innerWidth - 190), top: Math.min(menu.y, window.innerHeight - 120) }}
            onClick={(e) => e.stopPropagation()}>
            <button type="button" className="ctx-item" onClick={() => { setDetail(menu.entry); setMenu(null); }}>{tr("查看详情")}</button>
            <button type="button" className="ctx-item" onClick={() => { void navigator.clipboard?.writeText(detailText(menu.entry)); setToast("已复制"); setMenu(null); }}>{tr("复制")}</button>
          </div>
        </div>
      )}

      {toast && <div className="log-toast">{toast}</div>}
    </>
  );
}
