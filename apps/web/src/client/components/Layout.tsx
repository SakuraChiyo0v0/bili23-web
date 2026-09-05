import { useState } from "react";
import { TermsPanel } from "./TermsPanel";
import { FavoritesFlyout } from "./FavoritesFlyout";
import { useParseSession } from "../store/useParseSession";
import { Icon } from "../lib/icons";
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
}: {
  title: string;
  route: RouteId;
  onNavigate: (id: RouteId) => void;
}) {
  void route;
  return (
    <header className="topbar">
      <div className="topbar-title">{title}</div>
      <div className="topbar-actions">
        <button type="button" className="icon-btn" onClick={() => onNavigate("settings")} aria-label="设置" title="设置">
          <Icon name="gear" size={19} />
        </button>
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
          <button type="button" className="nav-item" onClick={() => setAboutOpen(true)}>
            <Icon name="info" size={19} />
            <span className="nav-label">关于</span>
          </button>
          <div className="nav-spacer" />
          {loggedIn ? (
              <button type="button" className="nav-item" onClick={onLogout} title={(uname ? uname + " · " : "") + (preview || "") + (mid ? " · UID " + mid : "")}>
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
      <FavoritesFlyout open={favOpen} onClose={() => setFavOpen(false)} onOpenFolder={(/*title*/ _title, mediaId) => { parseSession.setParseType("favlist"); parseSession.setInput("https://www.bilibili.com/list/ml" + mediaId); onNavigate("parse"); setFavOpen(false); }} onOpenBangumi={(url) => { parseSession.setParseType("bangumi"); parseSession.setInput(url); onNavigate("parse"); setFavOpen(false); }} />
      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
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
