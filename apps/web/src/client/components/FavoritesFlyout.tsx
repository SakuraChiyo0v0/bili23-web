import { useEffect, useState } from "react";
import { listFavorites, listFollowBangumi, type FavFolder, type FollowBangumi } from "../services/client";
import { Icon } from "../lib/icons";

export function FavoritesFlyout({
  open, onClose, onOpenFolder, onOpenBangumi,
}: {
  open: boolean; onClose: () => void;
  onOpenFolder: (title: string, mediaId: number) => void;
  onOpenBangumi: (url: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [folders, setFolders] = useState<FavFolder[]>([]);
  const [bangumi, setBangumi] = useState<FollowBangumi[]>([]);
  const [bangumiLoading, setBangumiLoading] = useState(false);
  const [tab, setTab] = useState<"fav" | "bangumi">("fav");

  useEffect(() => {
    if (!open) return;
    setLoading(true); setError("");
    setFolders([]); setBangumi([]);
    listFavorites()
      .then((r) => setFolders(r.folders))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open || tab !== "bangumi") return;
    setBangumiLoading(true); setError("");
    listFollowBangumi("1")
      .then((r) => setBangumi(r.follow))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBangumiLoading(false));
  }, [open, tab]);

  if (!open) return null;

  return (
    <div className="overlay sheet-on-mobile center-mobile" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal md fav-flyout">
        <div className="modal-head">
          <div className="modal-title">收藏夹 / 追番</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭"><Icon name="x" size={18} /></button>
        </div>
        <div className="login-tabs">
          <button className={`login-tab${tab === "fav" ? " active" : ""}`} onClick={() => setTab("fav")}>我的收藏夹</button>
          <button className={`login-tab${tab === "bangumi" ? " active" : ""}`} onClick={() => setTab("bangumi")}>追番/追剧</button>
        </div>
        <div className="modal-body fav-body">
          {loading || bangumiLoading ? <div className="empty-state"><span className="spinner" /><p>加载中…</p></div>
            : error ? <div className="empty-state"><p className="muted">{error}</p><p className="small muted">请先在侧栏登录（扫码/Cookie）</p></div>
            : tab === "fav" ? (
              folders.length === 0 ? <div className="empty-state"><p className="muted">暂无收藏夹</p></div> : (
                <div className="fav-grid">
                  {folders.map((f) => (
                    <button key={f.id} type="button" className="fav-item" onClick={() => onOpenFolder(f.title, f.id)}>
                      {f.cover ? <img className="fav-cover" src={f.cover} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e)=>{ (e.currentTarget as HTMLImageElement).style.display="none"; }} /> : <div className="fav-cover-placeholder"><Icon name="folder" size={22} /></div>}
                      <span className="fav-name">{f.title}</span>
                      <span className="fav-sub">{f.mediaCount} 个内容</span>
                    </button>
                  ))}
                </div>
              )
            ) : (
              bangumi.length === 0 ? <div className="empty-state"><p className="muted">暂无追番/追剧</p></div> : (
                <div className="fav-grid bangumi-grid">
                  {bangumi.map((b) => (
                    <button key={b.seasonId} type="button" className="fav-item" onClick={() => onOpenBangumi(b.url)}>
                      {b.cover ? <img className="fav-cover" src={b.cover} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e)=>{ (e.currentTarget as HTMLImageElement).style.display="none"; }} /> : <div className="fav-cover-placeholder"><Icon name="star" size={22} /></div>}
                      <span className="fav-name">{b.title}</span>
                      <span className="fav-sub">{b.newEp ? `更新至 ${b.newEp}` : b.isFinish ? "已完结" : "连载中"}</span>
                      {b.progress && <span className="fav-progress">{b.progress}</span>}
                    </button>
                  ))}
                </div>
              )
            )}
        </div>
        <div className="modal-foot">
          <div className="right"><button type="button" className="btn" onClick={onClose}>关闭</button></div>
        </div>
      </div>
    </div>
  );
}