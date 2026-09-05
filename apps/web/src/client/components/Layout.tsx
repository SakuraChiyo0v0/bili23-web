import { useEffect, useState } from "react";
import { TermsPanel } from "./TermsPanel";
import { FavoritesFlyout } from "./FavoritesFlyout";
import { useParseSession } from "../store/useParseSession";
import { Icon } from "../lib/icons";
import { listParseHistory, deleteParseHistory, parseUrl, type ParseHistoryItem } from "../services/client";
import { useToast } from "../lib/toast";
import type { RouteId } from "../lib/routes";

const TABS: Array<{ id: RouteId; label: string }> = [
  { id: "parse", label: "解析" },
  { id: "downloads", label: "下载" },
  { id: "settings", label: "设置" },
];

export function TopBar({
  title,
  route,
  onNavigate,
  loggedIn,
  uname,
  face,
  mid,
  preview,
  onLogin,
  onLogout,
}: {
  title: string;
  route: RouteId;
  onNavigate: (id: RouteId) => void;
  loggedIn: boolean;
  uname?: string;
  face?: string;
  mid?: number;
  preview?: string;
  onLogin: () => void;
  onLogout: () => void;
}) {
  void route;
  const [profileOpen, setProfileOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  return (
    <header className="topbar">
      <div className="topbar-title">{title}</div>
      <div className="topbar-actions">
        {loggedIn ? (
          <button type="button" className="icon-btn avatar-btn" onClick={() => setProfileOpen(true)} aria-label="账号" title="账号">
            {face ? (
              <img className="avatar-img" src={face} alt="" referrerPolicy="no-referrer" width={26} height={26} onError={(e) => { const el = e.currentTarget as HTMLImageElement; el.style.display = "none"; }} />
            ) : (
              <span className="avatar" style={{ width: 26, height: 26, fontSize: 12 }}>{uname?.charAt(0) || "用"}</span>
            )}
          </button>
        ) : (
          <button type="button" className="icon-btn" onClick={onLogin} aria-label="登录" title="登录">
            <Icon name="user" size={19} />
          </button>
        )}
        <button type="button" className="icon-btn" onClick={() => setHistoryOpen(true)} aria-label="解析历史" title="解析历史">
          <Icon name="history" size={19} />
        </button>
        <button type="button" className="icon-btn" onClick={() => onNavigate("settings")} aria-label="设置" title="设置">
          <Icon name="gear" size={19} />
        </button>
        <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} uname={uname} face={face} mid={mid} preview={preview} onLogout={() => { setProfileOpen(false); onLogout(); }} />
        <HistoryModal open={historyOpen} onClose={() => setHistoryOpen(false)} onNavigate={onNavigate} />
      </div>
    </header>
  );
}

export function MobileTabBar({ route, onNavigate }: { route: RouteId; onNavigate: (id: RouteId) => void }) {
  return (
    <nav className="tabbar" aria-label="主导航">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`tabbar-item${route === t.id ? " active" : ""}`}
          onClick={() => onNavigate(t.id)}
          aria-current={route === t.id ? "page" : undefined}
        >
          <Icon name={t.id === "parse" ? "search" : t.id === "downloads" ? "download" : "gear"} size={22} />
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}

export function Sidebar({
  route,
  onNavigate,
  onLogin,
  loggedIn,
  preview,
  uname,
  face,
  mid,
  onLogout,
}: {
  route: RouteId;
  onNavigate: (id: RouteId) => void;
  onLogin: () => void;
  loggedIn: boolean;
  preview: string;
  uname?: string;
  face?: string;
  mid?: number;
  onLogout: () => void;
}) {
  const [aboutOpen, setAboutOpen] = useState(false);
  const [favOpen, setFavOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const parseSession = useParseSession();
  return (
    <>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo">B</div>
          <div>
            <div className="brand-name">Bili23 Web</div>
            <div className="brand-sub">下载工具 · Web 版</div>
          </div>
        </div>
        <nav className="nav">
          <button type="button" className={`nav-item${route === "parse" ? " active" : ""}`} onClick={() => onNavigate("parse")}>
            <Icon name="search" size={19} />
            <span className="nav-label">解析</span>
          </button>
          <button type="button" className={`nav-item${route === "downloads" ? " active" : ""}`} onClick={() => onNavigate("downloads")}>
            <Icon name="download" size={19} />
            <span className="nav-label">下载</span>
            <span className="nav-badge hidden">0</span>
          </button>
          <button type="button" className="nav-item" onClick={() => setFavOpen(true)}>
            <Icon name="star" size={19} />
            <span className="nav-label">收藏夹</span>
          </button>
          <button type="button" className="nav-item" onClick={() => setHistoryOpen(true)}>
            <Icon name="history" size={19} />
            <span className="nav-label">解析历史</span>
          </button>
          <button type="button" className="nav-item" onClick={() => setAboutOpen(true)}>
            <Icon name="info" size={19} />
            <span className="nav-label">关于</span>
          </button>
          <div className="nav-spacer" />
          {loggedIn ? (
              <button type="button" className="nav-item" onClick={() => setProfileOpen(true)} title={(uname ? uname + " · " : "") + (preview || "") + (mid ? " · UID " + mid : "")}>
              {face ? (
                <span className="avatar" style={{ width: 26, height: 26 }}>
                  <img className="avatar-img" src={face} alt="" referrerPolicy="no-referrer" onError={(e) => { const el = e.currentTarget as HTMLImageElement; el.style.display = "none"; const p = el.parentElement; if (p) p.textContent = (uname?.charAt(0) || "用"); }} />
                </span>
              ) : (
                <span className="avatar" style={{ width: 26, height: 26, fontSize: 12 }}>{uname?.charAt(0) || "用"}</span>
              )}
              <span className="nav-label">{uname || "已登录"}{preview ? " · " + preview : ""}</span>
            </button>
          ) : (
            <button type="button" className="nav-item" onClick={onLogin}>
              <span className="avatar guest" style={{ width: 26, height: 26, fontSize: 12 }}>登</span>
              <span className="nav-label">未登录 · 点击登录</span>
            </button>
          )}
          <button type="button" className={`nav-item${route === "settings" ? " active" : ""}`} onClick={() => onNavigate("settings")}>
            <Icon name="gear" size={19} />
            <span className="nav-label">设置</span>
          </button>
        </nav>
      </aside>
      <HistoryModal open={historyOpen} onClose={() => setHistoryOpen(false)} onNavigate={onNavigate} />
      <FavoritesFlyout open={favOpen} onClose={() => setFavOpen(false)} onOpenFolder={(/*title*/ _title, mediaId) => { parseSession.setParseType("favlist"); parseSession.setInput("https://www.bilibili.com/list/ml" + mediaId); onNavigate("parse"); setFavOpen(false); }} onOpenBangumi={(url) => { parseSession.setParseType("bangumi"); parseSession.setInput(url); onNavigate("parse"); setFavOpen(false); }} />
      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
      <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} uname={uname} face={face} mid={mid} preview={preview} onLogout={() => { setProfileOpen(false); onLogout(); }} />
    </>
  );
}

export function AboutModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [showTerms, setShowTerms] = useState(false);
  if (!open) return null;
  return (
    <div className="overlay sheet-on-mobile" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal sm" role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className="modal-title">关于 Bili23 Web</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="modal-body center">
          <div className="about-logo">B</div>
          <h3>Bili23 Web</h3>
          <p className="muted small">桌面版 Bili23-Downloader 的 1:1 Web 复刻</p>
          <p className="small muted">信息架构 / 交互 1:1 对齐原版 PyQt 客户端，Web 化视觉与响应式增强。<br />Web 版 · 2026-09</p>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn ghost" onClick={() => setShowTerms((s) => !s)}>使用协议</button>
          <div className="right">
            <button type="button" className="btn" onClick={onClose}>关闭</button>
          </div>
        </div>
      </div>
      {showTerms && (
        <div className="overlay sheet-on-mobile center-mobile" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowTerms(false); }}>
          <div className="modal md">
            <div className="modal-head">
              <div className="modal-title">使用协议</div>
              <button type="button" className="icon-btn" onClick={() => setShowTerms(false)} aria-label="关闭"><Icon name="x" size={18} /></button>
            </div>
            <div className="modal-body"><TermsPanel /></div>
            <div className="modal-foot"><div className="right"><button type="button" className="btn" onClick={() => setShowTerms(false)}>关闭</button></div></div>
          </div>
        </div>
      )}
    </div>
  );
}


export function ProfileModal({ open, onClose, uname, face, mid, preview, onLogout }: {
  open: boolean; onClose: () => void; uname?: string; face?: string; mid?: number; preview?: string; onLogout: () => void;
}) {
  if (!open) return null;
  const fallback = (el: HTMLImageElement) => { el.style.display = "none"; const p = el.parentElement; if (p) p.textContent = (uname?.charAt(0) || "用"); };
  return (
    <div className="overlay sheet-on-mobile center-mobile" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal sm" role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className="modal-title">账号</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭"><Icon name="x" size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="profile-row">
            <span className="avatar profile-avatar">
              {face ? <img className="avatar-img" src={face} alt="" referrerPolicy="no-referrer" width={48} height={48} onError={(e) => fallback(e.currentTarget)} /> : null}
              {face ? null : (uname?.charAt(0) || "用")}
            </span>
            <div className="profile-meta">
              <div className="profile-uname">{uname || "已登录"}</div>
              <div className="muted small">{mid ? "UID " + mid : preview ? "已登录" : ""}</div>
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onLogout}>退出登录</button>
          <div className="right">
            {mid ? (
              <a className="btn" href={"https://space.bilibili.com/" + mid} target="_blank" rel="noreferrer" onClick={onClose}>打开 B 站主页</a>
            ) : null}
            <button type="button" className="btn" onClick={onClose}>关闭</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function HistoryModal({ open, onClose, onNavigate }: {
  open: boolean; onClose: () => void; onNavigate: (id: RouteId) => void;
}) {
  const { toast } = useToast();
  const parseSession = useParseSession();
  const [items, setItems] = useState<ParseHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");

  useEffect(() => { if (open) void refresh(); /* eslint-disable-next-line */ }, [open]);

  const refresh = async () => {
    setLoading(true); setError("");
    try {
      const { history } = await listParseHistory();
      setItems(history);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  };

  const openItem = async (item: ParseHistoryItem) => {
    setBusyId(item.id);
    try {
      const r = await parseUrl({ urls: [item.url] });
      const results = r.results;
      if (!results.length) throw new Error("解析结果为空");
      parseSession.setInput(item.url);
      parseSession.setParseType("auto");
      parseSession.start();
      parseSession.success(results);
      toast("已重新解析：" + item.title, "ok");
      onClose();
      onNavigate("parse");
    } catch (e) {
      toast("解析失败：" + (e instanceof Error ? e.message : String(e)), "err");
    } finally { setBusyId(null); }
  };

  const remove = async (id: number) => {
    try {
      await deleteParseHistory(id);
      setItems((cur) => cur.filter((x) => x.id !== id));
      toast("已删除该条解析记录", "ok");
    } catch (e) {
      toast("删除失败：" + (e instanceof Error ? e.message : String(e)), "err");
    }
  };

  if (!open) return null;

  return (
    <div className="overlay sheet-on-mobile center-mobile" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal md" role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className="modal-title">解析历史</div>
          <button type="button" className="icon-btn" onClick={() => { setItems([]); onClose(); }} aria-label="关闭"><Icon name="x" size={18} /></button>
        </div>
        <div className="modal-body">
          {error && <p className="danger small">加载失败：{error}</p>}
          {items.length === 0 && !loading && <p className="muted small center">暂无解析历史</p>}
          <div className="history-list">
            {items.map((item) => (
              <div key={item.id} className="history-row">
                <div className="history-main" onClick={() => void openItem(item)}>
                  <div className="history-title">{item.title}</div>
                  <div className="muted small history-url">{item.url}</div>
                </div>
                <span className="badge history-count">{item.itemCount} 项</span>
                <button type="button" className="btn sm ghost" disabled={busyId === item.id} onClick={() => void openItem(item)}>{busyId === item.id ? "解析中…" : "解析"}</button>
                <button type="button" className="btn sm ghost dangerous" onClick={() => void remove(item.id)}>删除</button>
              </div>
            ))}
          </div>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn ghost" onClick={() => void refresh()}>{loading ? "加载中…" : "刷新"}</button>
          <div className="right"><button type="button" className="btn" onClick={() => { setItems([]); onClose(); }}>关闭</button></div>
        </div>
      </div>
    </div>
  );
}
