import { useCallback, useEffect, useMemo, useState } from "react";
import { listFiles, fileRawUrl } from "../services/client";
import { fmtBytes } from "../lib/taskText";
import { Icon } from "../lib/icons";
import { t as tr } from "../lib/i18n";

interface FileEntry { name: string; path: string; size: number; mtime: number }

type SortKey = "name" | "size" | "mtime";

/**
 * 产物浏览页。
 *
 * ⚠️ **原版没有这一页** —— 原版工具栏的「打开下载目录」是调系统文件管理器打开目录，
 * 浏览器里没有等价物。设计稿 §四 把它的 Web 落点定为「产物在线下载（`/api/files/raw` 已存在）+ 产物浏览页」，
 * 所以这一页是**为 Web 补的对应物**，不是复刻原版的某个界面。
 *
 * 因此它**不进导航栏**（导航项集合保持原版那 6 项），入口在下载页工具栏的「打开下载目录」上。
 */
export function FilesPage() {
  const [files, setFiles] = useState<FileEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "mtime", desc: true });

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const r = await listFiles();
      setFiles(r.files);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const list = useMemo(() => {
    const kw = q.trim().toLowerCase();
    const filtered = (files ?? []).filter((f) => !kw || f.name.toLowerCase().includes(kw) || f.path.toLowerCase().includes(kw));
    const dir = sort.desc ? -1 : 1;
    return [...filtered].sort((a, b) => {
      const va = sort.key === "name" ? a.name.toLowerCase() : sort.key === "size" ? a.size : a.mtime;
      const vb = sort.key === "name" ? b.name.toLowerCase() : sort.key === "size" ? b.size : b.mtime;
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }, [files, q, sort]);

  const totalBytes = useMemo(() => list.reduce((n, f) => n + f.size, 0), [list]);

  const clickHeader = (key: SortKey) => setSort((prev) => (prev.key === key ? { key, desc: !prev.desc } : { key, desc: true }));
  const th = (key: SortKey, label: string, cls = "") => (
    <button type="button" className={`files-th${cls ? " " + cls : ""}${sort.key === key ? " on" : ""}`} onClick={() => clickHeader(key)}>
      {label}{sort.key === key && <Icon name="chevD" size={12} style={sort.desc ? undefined : { transform: "rotate(180deg)" }} />}
    </button>
  );

  return (
    <section className="page">
      <div className="page-head">
        <div className="panel-title">{tr("产物")}</div>
        <div className="spacer" />
        <span className="muted small">{list.length} 个文件 · {fmtBytes(totalBytes)}</span>
        <button type="button" className="btn sm ghost" onClick={() => { window.location.hash = "#/downloads"; }}>{tr("返回下载")}</button>
        <button type="button" className="btn sm" onClick={() => void load()} disabled={loading}>{loading ? tr("刷新中…") : tr("刷新")}</button>
      </div>

      <div className="tree-search">
        <Icon name="search" size={16} />
        <input className="text-input" placeholder={tr("按文件名或路径筛选…")} value={q} onChange={(e) => setQ(e.target.value)} />
        {q && <button type="button" className="btn sm ghost" onClick={() => setQ("")}>{tr("清除")}</button>}
      </div>

      {error ? (
        <div className="empty-state"><p className="muted">加载失败：{error}</p></div>
      ) : files === null ? (
        <div className="empty-state"><span className="spinner" /><p>{tr("读取产物目录…")}</p></div>
      ) : list.length === 0 ? (
        <div className="empty-state">
          <Icon name="folder" size={52} />
          <h3>{q ? tr("没有匹配的产物") : tr("下载目录里还没有产物")}</h3>
          <p>{tr("下载完成后的文件会出现在这里，可直接下载到本机。")}</p>
        </div>
      ) : (
        <div className="files">
          <div className="files-head">
            {th("name", "文件名", "files-c-name")}
            <span className="files-th static files-c-dir">{tr("目录")}</span>
            {th("size", "大小", "files-c-size")}
            {th("mtime", "修改时间", "files-c-time")}
            <span className="files-th static files-c-op">{tr("操作")}</span>
          </div>
          <div className="files-body">
            {list.map((f) => {
              const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "/";
              return (
                <div className="files-row" key={f.path}>
                  <span className="files-c-name files-name" title={f.path}>{f.name}</span>
                  <span className="files-c-dir muted small" title={dir}>{dir}</span>
                  <span className="files-c-size muted small">{fmtBytes(f.size)}</span>
                  <span className="files-c-time muted small">{new Date(f.mtime * 1000).toLocaleString()}</span>
                  <span className="files-c-op">
                    <a className="btn sm" href={fileRawUrl(f.path)} target="_blank" rel="noreferrer" download>{tr("下载")}</a>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
