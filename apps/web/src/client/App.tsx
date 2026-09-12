import { useCallback, useEffect, useState } from "react";
import { useTermsGate } from "./lib/useTermsGate";
import { useHashRoute, type RouteId } from "./lib/routes";
import { useToast, ToastProvider } from "./lib/toast";
import { NavRail, MobileTopBar, TabBar } from "./components/Layout";
import { AboutDialog } from "./components/AboutDialog";
import { ProfileDialog } from "./components/ProfileDialog";
import { LoginRequiredDialog } from "./components/LoginRequiredDialog";
import { TeachingTip } from "./components/TeachingTip";
import { FavoritesPage } from "./pages/FavoritesPage";
import { LoginDialog } from "./components/LoginDialog";
import { useAuthStore } from "./store/useAuthStore";
import { useSettingsStore } from "./store/useSettingsStore";
import { useParseSession } from "./store/useParseSession";
import { TermsPanel } from "./components/TermsPanel";
import { ParsePage } from "./pages/ParsePage";
import { TasksPage } from "./pages/TasksPage";
import { SettingsPage } from "./pages/SettingsPage";
import { FilesPage } from "./pages/FilesPage";
import { t as tr, resolveLang, setCurrentLang, type Lang } from "./lib/i18n";
import { applyMotion } from "./lib/theme";
import { saveJSON } from "./lib/storage";
import { MOTION_KEY } from "./lib/useUiSettings";

export function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}

function Shell() {
  const [route, navigate] = useHashRoute();
  const [accepted, accept] = useTermsGate();
  const { toast } = useToast();
  // 弹窗状态上提到外壳：导航有「左侧竖排」和「窄屏顶栏」两套承载形态，
  // 状态放这里才能让两者共用同一个弹窗实例（否则要挂两份，还会各弹各的）。
  const [loginOpen, setLoginOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [needLoginOpen, setNeedLoginOpen] = useState(false);
  /** 未登录教学气泡（原版 `main_window.py:36-37,110-122`）：每次启动只要没登录就提示一次 */
  const [loginTipOpen, setLoginTipOpen] = useState(false);
  const [loginTipTarget, setLoginTipTarget] = useState<HTMLElement | null>(null);
  const auth = useAuthStore();
  const parseSession = useParseSession();
  const loadConfig = useSettingsStore((s) => s.load);
  const cfgLang = useSettingsStore((s) => s.config?.behavior?.language);
  const cfgMotion = useSettingsStore((s) => s.config?.behavior?.motion);
  /**
   * 语言（i18n）。两个要点：
   * 1. **在渲染期**调用 `setCurrentLang` —— 它是模块级状态，`t()` 在子组件渲染时读它；
   *    放 useEffect 里就太晚了（effect 之后没有重渲染，界面会停留在旧语言）。
   *    同一个渲染批次里父组件先执行，所以下面整棵树都能读到新语言。
   * 2. 下面给 `.app` 挂 `key={lang}`：换语言时整棵树**重挂**，各处静态调用自然重算，
   *    省掉在 48 个文件里逐处订阅 store。
   */
  /**
   * 动效偏好以**配置**为准（与主题同一条路子）：配置同步到 localStorage 镜像 `ui.motion`，
   * 给下次首屏在 React 渲染前用（见 main.tsx）。原先它只存在 localStorage、且启动时不应用。
   */
  useEffect(() => {
    if (!cfgMotion) return;
    applyMotion(cfgMotion);
    saveJSON(MOTION_KEY, cfgMotion);
  }, [cfgMotion]);

  const lang: Lang = resolveLang(cfgLang, typeof navigator !== "undefined" ? navigator.language : undefined);
  setCurrentLang(lang);
  // 全局配置要在解析之前就位：解析成功的"自动勾选"策略（behavior.autoSelectMode）由它决定，
  // 否则没进过设置页就直接解析时，只能退回原版默认值。
  useEffect(() => {
    if (!useSettingsStore.getState().config) void loadConfig();
    void auth.refresh(); /*eslint-disable-next-line*/
  }, []);

  // 登录态检查完成后仍未登录 → 头像旁挂一次教学气泡（原版没有"看过就不再提示"的记账，
  // 每次启动未登录都会提示；这里保持一致）
  useEffect(() => {
    if (!auth.checked || auth.loggedIn) { setLoginTipOpen(false); return; }
    const timer = setTimeout(() => {
      const el = document.querySelector<HTMLElement>(".avatar-login-btn");
      if (!el) return;
      setLoginTipTarget(el);
      setLoginTipOpen(true);
    }, 80);
    return () => clearTimeout(timer);
  }, [auth.checked, auth.loggedIn]);

  if (!accepted) {
    return (
      <div className="terms-gate">
        <TermsGateCard onAccept={accept} />
      </div>
    );
  }

  /** 收藏夹页点条目 → 去解析页**并直接开始解析**（原版浮层点条目就是直接解析，不该再让用户点一下） */
  const gotoParse = useCallback((url: string) => {
    // 收藏夹页给的都是自描述链接（收藏夹 / 合集 / 追番 / bili23:// 伪协议），一律走自动识别，
    // 不要在进解析页后还沿用用户上次选的类型
    parseSession.setParseType("auto");
    parseSession.setInput(url);
    // 一次性标志：ParsePage 挂载后自己调用与「解析」按钮同一个 doParse()
    parseSession.requestAutoRun();
    navigate("parse");
  }, [parseSession, navigate]);

  const renderPage = () => {
    if (route.id === "parse") return <ParsePage />;
    if (route.id === "downloads") return <TasksPage />;
    // 收藏夹：原版是浮层，这里按 Web 形态做成页面（内容与层级不变）
    if (route.id === "favorites") return <FavoritesPage onParse={gotoParse} mid={auth.mid} />;
    if (route.id === "settings") return <SettingsPage />;
    // 剩下的只有 files（产物浏览页）；导航里没有它，入口在下载页工具栏
    return <FilesPage />;
  };

  const logout = async () => {
    const { logoutAuth } = await import("./services/client");
    await logoutAuth();
    await auth.refresh();
    toast(tr("已退出登录"));
  };

  const navProps = {
    route: route.id,
    onNavigate: (id: RouteId) => navigate(id),
    loggedIn: auth.loggedIn,
    uname: auth.uname,
    face: auth.face,
    mid: auth.mid,
    preview: auth.preview,
    onLogin: () => setLoginOpen(true),
    onOpenProfile: () => setProfileOpen(true),
    // 原版：未登录时点「收藏夹」弹「需要登录 / 请先登录账号」（main_window.py:310-321），
    // 而不是把浮层打开、里面显示一句错误
    onOpenFavorites: () => {
      if (!auth.loggedIn) { setNeedLoginOpen(true); return; }
      navigate("favorites");
    },
    onOpenAbout: () => setAboutOpen(true),
  };

  return (
    // key=语言：换语言时整棵界面重挂，各处 tr("…") 用新语言重算（见上面 lang 的注释）
    <div className="app" key={lang}>
      <NavRail {...navProps} />
      <div className="main">
        <MobileTopBar {...navProps} />
        {/* 收藏夹页要铺满内容区（用户要求），所以这一路由下让 .content 不留内边距、也不自己滚动 */}
        <main className={route.id === "favorites" ? "content flush" : "content"}>{renderPage()}</main>
        <TabBar route={route.id} onNavigate={navigate} />
      </div>

      <LoginDialog open={loginOpen} onClose={() => setLoginOpen(false)} />
      <ProfileDialog
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        uname={auth.uname}
        face={auth.face}
        mid={auth.mid}
        preview={auth.preview}
        onLogout={() => { setProfileOpen(false); void logout(); }}
      />
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
      <LoginRequiredDialog
        open={needLoginOpen}
        onClose={() => setNeedLoginOpen(false)}
        onLogin={() => { setNeedLoginOpen(false); setLoginOpen(true); }}
      />
      {/* 未登录教学气泡（原版 `main_window.py:110-122`：标题「登录账号」+ 头像旁的左侧尾巴） */}
      <TeachingTip
        open={loginTipOpen}
        target={loginTipTarget}
        title={tr("登录账号")}
        content={tr("点击头像登录哔哩哔哩账号，未登录状态下下载功能将受限")}
        tail="left"
        onClose={() => setLoginTipOpen(false)}
      />
    </div>
  );
}

function TermsGateCard({ onAccept }: { onAccept: () => void }) {
  return (
    <div className="terms-gate-card">
      <div className="terms-gate-head">
        <div className="brand-logo">B</div>
        <h1>Bili23 Web</h1>
        <p className="muted small">{tr("使用前请阅读并接受以下条款")}</p>
      </div>
      <TermsPanel />
      <div className="modal-foot">
        <button type="button" className="btn" onClick={() => alert("未接受条款无法继续使用本应用。")}>
          拒绝
        </button>
        <div className="right">
          <button type="button" className="btn primary" onClick={onAccept}>
            接受并继续
          </button>
        </div>
      </div>
    </div>
  );
}
