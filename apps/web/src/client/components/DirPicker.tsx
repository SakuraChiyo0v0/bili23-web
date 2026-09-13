import { useEffect, useState } from "react";
import { getSystemInfo, listDirs } from "../services/client";
import { t as tr } from "../lib/i18n";
import { Overlay } from "./Overlay";

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
  /** 服务器信息：**必须**让用户知道这是哪台机器上的目录（否则会以为选错了） */
  const [host, setHost] = useState<{ host: string; localhost: boolean } | null>(null);

  useEffect(() => {
    if (!open) return;
    // 没给起始目录时别用 "/"：Windows 下那不是根，列出来一堆空。
    // 先问服务端要"下载目录 / 数据目录 / 盘符"，用它作为起点。
    let cancelled = false;
    void getSystemInfo().then((r) => {
      if (cancelled) return;
      setHost({ host: r.host, localhost: r.localhost });
      const start = value || r.downloadDir || "/";
      setCurrent(start);
      setManual(value || "");
      setError("");
    }).catch(() => {
      setCurrent(value || "/");
      setManual(value || "");
    });
    return () => { cancelled = true; };
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

  /**
   * 上级目录。⚠️ 原来只用 "/" 找分隔符 —— Windows 路径全是反斜杠，
   * 于是一路"往上"其实直接跳回盘根（`C:\`），看着像不能往上走。
   * 另外盘根（`C:\`）与 UNC 根（`\\server\share`）都不该再往上。
   */
  /** 已经在根上（盘根 C:\ / POSIX 根 / UNC 根）就没法再往上了 */
  const atRoot = (p: string): boolean => {
    const t = p.replace(/[\\/]+$/, "");
    return /^[A-Za-z]:$/.test(t) || t === "" || t === "/" || /^\\\\[^\\]+\\[^\\]+$/.test(t);
  };
  const up = () => {
    const trimmed = current.replace(/[\\/]+$/, "");
    if (/^[A-Za-z]:$/.test(trimmed)) return;                       // C: → 已到盘根
    const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
    if (idx > 2) { const parent = trimmed.slice(0, idx); setCurrent(parent); setManual(parent); return; }
    if (/^[A-Za-z]:/.test(trimmed)) { setCurrent(trimmed.slice(0, 2) + "\\"); return; }
    setCurrent("/");
  };
  const enter = (path: string) => { setCurrent(path); setManual(path); };
  const confirmPick = () => { const dir = manual.trim().replace(/[\\/]+$/, "") || "/"; onPick(dir); onClose(); };

  return (
    <Overlay open={open} onClose={onClose} size="md" sheetOnMobile centerOnMobile>
        <div className="modal-head">
          <div className="modal-title">{tr("选择下载目录")}</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={tr("关闭")}>
            <svg className="ico" viewBox="0 0 24 24" width={18} height={18}><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="modal-body">
          {/* 这是哪台机器上的目录 —— 用户选「NAS 模式」却看到 C:\ 会以为选错了，必须直说 */}
          {host && (
            <p className="small muted" style={{ marginBottom: 6 }}>
              {tr("这里浏览的是运行服务的那台机器（{host}）上的目录").replace("{host}", host.host)}
              {host.localhost ? tr("—— 服务就跑在这台电脑上，所以看到的是本机路径") : ""}
            </p>
          )}

          <div className="dir-picker-current">
            <button type="button" className="btn sm ghost" onClick={up} disabled={atRoot(current)}>↑ 上级</button>
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
          <div className="dir-picker-tip"><span className="small muted">{tr("点击目录进入子目录，路径会同步到底部输入框；也可以直接在下面输入网络路径。")}</span></div>
        </div>
        <div className="modal-foot">
          <div className="dir-picker-manual">
            <input className="text-input" style={{ flex: 1 }} value={manual} onChange={(e) => setManual(e.target.value)} placeholder={tr("或直接输入路径：NAS 网络共享 \\\\NAS\\media、映射盘 Z:\\\\media、容器内路径…")} />
          </div>
          <div className="right">
            <button type="button" className="btn" onClick={onClose}>{tr("取消")}</button>
            <button type="button" className="btn primary" onClick={confirmPick}>{tr("使用此目录")}</button>
          </div>
        </div>
      </Overlay>
  );
}
