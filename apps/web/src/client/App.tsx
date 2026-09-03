import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import type { AppConfig, AuthStatus } from "./types.js";
import { Icon, type IconName } from "./components/icons.js";
import { ParseView } from "./views/ParseView.js";
import { TasksView } from "./views/TasksView.js";
import { SettingsView } from "./views/SettingsView.js";
import { cn } from "./utils.js";

type View = "parse" | "tasks" | "settings";

const NAV_ITEMS: Array<{ id: View; label: string; icon: IconName }> = [
  { id: "parse", label: "解析", icon: "search" },
  { id: "tasks", label: "下载", icon: "download" },
  { id: "settings", label: "设置", icon: "settings" },
];

export default function App() {
  const [view, setView] = useState<View>(() => {
    const hash = window.location.hash.replace("#", "");
    return hash === "tasks" || hash === "settings" ? hash : "parse";
  });
  const [config, setConfig] = useState<AppConfig>();
  const [auth, setAuth] = useState<AuthStatus>();
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" }>();
  const [taskRevision, setTaskRevision] = useState(0);

  const showToast = useCallback((message: string, tone: "success" | "error" = "success") => {
    setToast({ message, tone });
    window.setTimeout(() => setToast(undefined), 3200);
  }, []);

  useEffect(() => {
    window.location.hash = view;
  }, [view]);

  useEffect(() => {
    const load = async () => {
      try {
        const [nextConfig, nextAuth] = await Promise.all([api.getConfig(), api.authStatus()]);
        setConfig(nextConfig);
        setAuth(nextAuth);
      } catch (err) {
        showToast(err instanceof Error ? err.message : "服务配置加载失败", "error");
      }
    };
    void load();
  }, [showToast]);

  useEffect(() => {
    const theme = config?.behavior.theme ?? "system";
    const resolved = theme === "system"
      ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : theme;
    document.documentElement.dataset.theme = resolved;
  }, [config?.behavior.theme]);

  const navigate = (next: View) => setView(next);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <button className="brand" type="button" onClick={() => navigate("parse")}>
            <span className="brand-mark"><Icon name="sparkles" size={17} /></span>
            <span><strong>Bili23</strong><small>Web Downloader</small></span>
          </button>
          <nav className="desktop-nav" aria-label="主导航">
            {NAV_ITEMS.map((item) => (
              <button key={item.id} type="button" className={cn("nav-item", view === item.id && "is-active")} onClick={() => navigate(item.id)}>
                <Icon name={item.icon} size={17} />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
          <div className="topbar-status">
            <span className={cn("health-dot", auth?.loggedIn ? "is-online" : "")} />
            <span>{auth?.loggedIn ? `已登录 ${auth.preview}` : "匿名模式"}</span>
            <button className="theme-chip" type="button" onClick={() => setConfig((current) => current ? { ...current, behavior: { ...current.behavior, theme: current.behavior.theme === "dark" ? "light" : "dark" } } : current)} aria-label="切换主题"><Icon name={config?.behavior.theme === "dark" ? "sun" : "moon"} size={15} /></button>
          </div>
        </div>
      </header>

      <main className="main-content">
        {!config ? (
          <div className="app-loading"><span className="loading-orbit" /><strong>正在连接 Bili23 服务</strong><span>首次加载会读取 NAS 上的配置和任务状态。</span></div>
        ) : view === "parse" ? (
          <ParseView key={`parse-${taskRevision}`} config={config} onToast={showToast} onTasksChanged={() => setTaskRevision((value) => value + 1)} onNavigate={navigate} />
        ) : view === "tasks" ? (
          <TasksView onToast={showToast} />
        ) : (
          <SettingsView config={config} onConfigChange={setConfig} onToast={showToast} />
        )}
      </main>

      <nav className="mobile-nav" aria-label="移动端主导航">
        {NAV_ITEMS.map((item) => (
          <button key={item.id} type="button" className={cn("mobile-nav-item", view === item.id && "is-active")} onClick={() => navigate(item.id)}>
            <Icon name={item.icon} size={19} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {toast ? <div className={cn("toast", `toast-${toast.tone}`)}><Icon name={toast.tone === "success" ? "check" : "info"} size={16} /> {toast.message}</div> : null}
    </div>
  );
}