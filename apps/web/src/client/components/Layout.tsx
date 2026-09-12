import { useEffect } from "react";
import { Icon, type IconName } from "../lib/icons";
import { useTasksStore } from "../store/useTasksStore";
import { ROUTES, type RouteId } from "../lib/routes";
import { t as tr } from "../lib/i18n";

/**
 * 应用外壳：导航的三种承载形态。
 *
 * 依据 `docs/parity/07-前端UI重做-设计稿.md`：
 *   ≥1024        左侧 72px 竖排（图标在上、文字在下）常驻
 *   768–1023     同一竖排，只留图标
 *   <768         底部 TabBar（解析/下载/设置）+ 顶栏（头像 + 「更多」）
 *
 * **导航项集合照原版，不可改**（`gui/interface/main_window.py:418-470`）：
 *   上：解析 / 下载（带未完成数徽章）/ 收藏夹（页面，原版是浮层）/ 关于（弹出层）
 *   下：头像 / 设置
 * 注意「解析历史」不在导航里 —— 原版它是**解析页工具条上**的按钮（`parse.py:376`），
 * 因此这里不列它，由 `ParsePage` 承载。
 */

/** 底部 TabBar 的三个主页面（窄屏下其余项收进顶栏「更多」） */
/**
 * 底部 TabBar 的项（窄屏主入口）。
 * 原版桌面是左侧竖排 6 项；窄屏装不下，我们保留 4 项最常用的：
 * 解析 / 下载 / **收藏夹** / 设置（收藏夹原来是塞在顶栏的一颗小星星里，手机上根本找不到 —— 用户报"手机端没有收藏夹"）。
 */
const TABS: Array<{ id: RouteId; label: string; icon: IconName }> = [
  { id: "parse", label: "解析", icon: "search" },
  { id: "downloads", label: "下载", icon: "download" },
  { id: "favorites", label: "收藏夹", icon: "star" },
  { id: "settings", label: "设置", icon: "gear" },
];

interface ShellNavProps {
  route: RouteId;
  onNavigate: (id: RouteId) => void;
  loggedIn: boolean;
  uname?: string;
  face?: string;
  mid?: number;
  preview?: string;
  onLogin: () => void;
  onOpenProfile: () => void;
  onOpenFavorites: () => void;
  onOpenAbout: () => void;
}

/**
 * 下载项徽章：条数取「未完成任务数」。
 * 原版是 `update_download_btn_badge_info`：0 → 隐藏，>99 → 「99+」，其余显示数字。
 * 轮询只走 `refreshBadge`（不碰 loading），否则下载页会被徽章轮询带得一直闪加载。
 */
function useDownloadBadge(): string | null {
  const activeCount = useTasksStore((s) => s.activeCount);
  const refreshBadge = useTasksStore((s) => s.refreshBadge);
  useEffect(() => {
    void refreshBadge();
    const timer = window.setInterval(() => void refreshBadge(), 10000);
    return () => window.clearInterval(timer);
  }, [refreshBadge]);
  if (activeCount <= 0) return null;
  return activeCount > 99 ? "99+" : String(activeCount);
}

function AvatarButton({ loggedIn, uname, face, onLogin, onOpenProfile, size }: {
  loggedIn: boolean; uname?: string; face?: string; onLogin: () => void; onOpenProfile: () => void; size: number;
}) {
  const fallback = (el: HTMLImageElement) => { el.style.display = "none"; const p = el.parentElement; if (p) p.textContent = (uname?.charAt(0) || "用"); };
  if (!loggedIn) {
    return (
      <button type="button" className="nav-item avatar-login-btn" onClick={onLogin} title={tr("未登录 · 点击登录")}>
        <span className="avatar guest" style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}>{tr("登")}</span>
        <span className="nav-txt">{tr("登录")}</span>
      </button>
    );
  }
  return (
    <button type="button" className="nav-item" onClick={onOpenProfile} title={uname || "已登录"}>
      <span className="avatar" style={{ width: size, height: size }}>
        {face
          ? <img className="avatar-img" style={{ width: size, height: size }} src={face} alt="" referrerPolicy="no-referrer" onError={(e) => fallback(e.currentTarget)} />
          : (uname?.charAt(0) || "用")}
      </span>
      <span className="nav-txt">{tr("账号")}</span>
    </button>
  );
}

/** 左侧竖排导航（≥768px）。窄屏由 CSS 整体隐藏。 */
export function NavRail(props: ShellNavProps) {
  const { route, onNavigate, loggedIn, uname, face, onLogin, onOpenProfile, onOpenFavorites, onOpenAbout } = props;
  const badge = useDownloadBadge();
  return (
    <nav className="nav" aria-label={tr("主导航")}>
      <button type="button" className={`nav-item${route === "parse" ? " active" : ""}`} onClick={() => onNavigate("parse")} title={tr("解析")}>
        <Icon name="search" size={20} />
        <span className="nav-txt">{tr("解析")}</span>
      </button>
      <button type="button" className={`nav-item${route === "downloads" ? " active" : ""}`} onClick={() => onNavigate("downloads")} title={tr("下载")}>
        <Icon name="download" size={20} />
        <span className="nav-txt">{tr("下载")}</span>
        {badge && <span className="nav-badge">{badge}</span>}
      </button>
      {/* 收藏夹现在是**页面**（原版是浮层），所以和解析/下载/设置一样有选中态 */}
      <button type="button" className={`nav-item${route === "favorites" ? " active" : ""}`} onClick={onOpenFavorites} title={tr("收藏夹")}>
        <Icon name="star" size={20} />
        <span className="nav-txt">{tr("收藏夹")}</span>
      </button>
      <button type="button" className="nav-item" onClick={onOpenAbout} title={tr("关于")}>
        <Icon name="info" size={20} />
        <span className="nav-txt">{tr("关于")}</span>
      </button>

      <div className="nav-spacer" />

      <AvatarButton loggedIn={loggedIn} uname={uname} face={face} onLogin={onLogin} onOpenProfile={onOpenProfile} size={28} />
      <button type="button" className={`nav-item${route === "settings" ? " active" : ""}`} onClick={() => onNavigate("settings")} title={tr("设置")}>
        <Icon name="gear" size={20} />
        <span className="nav-txt">{tr("设置")}</span>
      </button>
    </nav>
  );
}

/** 窄屏顶栏：当前页标题 + 「更多」（收藏夹页 / 关于）+ 头像 */
export function MobileTopBar({ route, onNavigate, loggedIn, uname, face, onLogin, onOpenProfile, onOpenFavorites, onOpenAbout }: ShellNavProps) {
  void onNavigate;
  const badge = useDownloadBadge();
  const title = ROUTES.find((r) => r.id === route)?.title ?? "";
  return (
    <header className="topbar">
      <div className="topbar-title">
        {title}
        {route === "downloads" && badge && <span className="nav-badge inline">{badge}</span>}
      </div>
      <div className="topbar-actions">
        <button type="button" className={`icon-btn${route === "favorites" ? " active" : ""}`} onClick={onOpenFavorites} aria-label={tr("收藏夹")} title={tr("收藏夹")}>
          <Icon name="star" size={19} />
        </button>
        <button type="button" className="icon-btn" onClick={onOpenAbout} aria-label={tr("关于")} title={tr("关于")}>
          <Icon name="info" size={19} />
        </button>
        {loggedIn ? (
          <button type="button" className="icon-btn avatar-btn" onClick={onOpenProfile} aria-label={tr("账号")} title={uname || "账号"}>
            {face
              ? <img className="avatar-img" src={face} alt="" referrerPolicy="no-referrer" width={26} height={26} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
              : <span className="avatar" style={{ width: 26, height: 26, fontSize: 12 }}>{uname?.charAt(0) || "用"}</span>}
          </button>
        ) : (
          <button type="button" className="icon-btn avatar-login-btn" onClick={onLogin} aria-label={tr("登录")} title={tr("登录")}>
            <Icon name="user" size={19} />
          </button>
        )}
      </div>
    </header>
  );
}

/** 底部 TabBar（<768px） */
export function TabBar({ route, onNavigate, onOpenFavorites }: { route: RouteId; onNavigate: (id: RouteId) => void; /** 收藏夹要先过登录闸门（原版未登录点导航会弹「需要登录」） */ onOpenFavorites: () => void }) {
  const badge = useDownloadBadge();
  return (
    <nav className="tabbar" aria-label={tr("主导航")}>
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`tabbar-item${route === t.id ? " active" : ""}`}
          onClick={() => (t.id === "favorites" ? onOpenFavorites() : onNavigate(t.id))}
          aria-current={route === t.id ? "page" : undefined}
        >
          <Icon name={t.icon} size={22} />
          <span>{tr(t.label)}</span>
          {t.id === "downloads" && badge && <span className="nav-badge tab">{badge}</span>}
        </button>
      ))}
    </nav>
  );
}
