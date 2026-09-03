import { useEffect, useState } from "react";
import { listFavorites, type FavFolder } from "../services/client";

export function FavoritesFlyout({
  open, onClose, onOpenFolder,
}: {
  open: boolean; onClose: () => void;
  onOpenFolder: (title: string, mediaId: number) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [folders, setFolders] = useState<FavFolder[]>([]);
  const [tab, setTab] = useState<"fav" | "bangumi">("fav");

  useEffect(() => {
    if (!open) return;
    setLoading(true); setError("");
    listFavorites()
      .then((r) => setFolders(r.folders))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  return (
    <div className="overlay sheet-on-mobile center-mobile" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal md fav-flyout">
        <div className="modal-head">
          <div className="modal-title">收藏夹 / 追番</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            <svg className="ico" viewBox="0 0 24 24" width={18} height={18}><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="login-tabs">
          <button className={`login-tab${tab === "fav" ? " active" : ""}`} onClick={() => setTab("fav")}>我的收藏夹</button>
          <button className={`login-tab${tab === "bangumi" ? " active" : ""}`} onClick={() => setTab("bangumi")}>追番/追剧</button>
        </div>
        <div className="modal-body fav-body">
          {loading ? <div className="empty-state"><span className="spinner" /><p>加载收藏夹…</p></div>
            : error ? <div className="empty-state"><p className="muted">{error}</p><p className="small muted">请先在侧栏登录（扫码/Cookie）</p></div>
            : tab === "fav" ? (
              folders.length === 0 ? <div className="empty-state"><p className="muted">暂无收藏夹</p></div> : (
                <div className="fav-grid">
                  {folders.map((f) => (
                    <button key={f.id} type="button" className="fav-item" onClick={() => onOpenFolder(f.title, f.id)}>
                      <span className="fav-name">{f.title}</span>
                      <span className="fav-sub">{f.mediaCount} 个内容</span>
                    </button>
                  ))}
                </div>
              )
            ) : (
              <div className="empty-state"><p className="muted">追番/追剧使用「解析」页的番剧/剧集类型入口解析</p></div>
            )}
        </div>
        <div className="modal-foot">
          <div className="right"><button type="button" className="btn" onClick={onClose}>关闭</button></div>
        </div>
      </div>
    </div>
  );
}