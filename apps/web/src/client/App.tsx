import { useCallback, useEffect, useState } from "react";
import { useUiSettings } from "./lib/useUiSettings";
import { useTermsGate } from "./lib/useTermsGate";
import { useHashRoute, type RouteId } from "./lib/routes";
import { useToast, ToastProvider } from "./lib/toast";
import { Modal } from "./components/Modal";
import { Sidebar, TopBar, MobileTabBar } from "./components/Layout";
import { LoginDialog } from "./components/LoginDialog";
import { useAuthStore } from "./store/useAuthStore";
import { TermsPanel } from "./components/TermsPanel";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { ParsePage } from "./pages/ParsePage";
import { TasksPage } from "./pages/TasksPage";
import { SettingsPage } from "./pages/SettingsPage";

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
  const [ui, updateUi] = useUiSettings();
  const { toast } = useToast();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const auth = useAuthStore();
  useEffect(() => { void auth.refresh(); /*eslint-disable-next-line*/ }, []);

  const openSettings = useCallback(() => setSettingsOpen(true), []);

  if (!accepted) {
    return (
      <div className="terms-gate">
        <TermsGateCard onAccept={accept} />
      </div>
    );
  }

  const renderPage = () => {
    if (route.id === "parse") return <ParsePage />;
    if (route.id === "downloads") return <TasksPage />;
    if (route.id === "settings") return <SettingsPage />;
    return <PlaceholderPage key={route.id} route={route.id} />;
  };

  return (
    <div className="app">
      <Sidebar route={route.id} onNavigate={navigate} onLogin={() => setLoginOpen(true)} loggedIn={auth.loggedIn} preview={auth.preview} onLogout={async () => { const { logoutAuth } = await import("./services/client"); await logoutAuth(); await auth.refresh(); toast("已退出登录"); }} />
      <div className="main">
        <TopBar
          title={route.title}
          route={route.id}
          onNavigate={(id: RouteId) => {
            if (id === "settings") openSettings();
            else navigate(id);
          }}
          onToast={() => toast("这是全局提示（Toast），后续用于下载结果与操作反馈。")}
        />
        <main className="content">{renderPage()}</main>
        <MobileTabBar route={route.id} onNavigate={navigate} />
      </div>

      <LoginDialog open={loginOpen} onClose={() => setLoginOpen(false)} />
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        theme={ui.theme}
        motion={ui.motion}
        onChangeTheme={(theme) => updateUi({ theme })}
        onChangeMotion={(motion) => updateUi({ motion })}
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
        <p className="muted small">使用前请阅读并接受以下条款</p>
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

function SettingsDialog({
  open,
  onClose,
  theme,
  motion,
  onChangeTheme,
  onChangeMotion,
}: {
  open: boolean;
  onClose: () => void;
  theme: "light" | "dark" | "system";
  motion: "smooth" | "reduced";
  onChangeTheme: (v: "light" | "dark" | "system") => void;
  onChangeMotion: (v: "smooth" | "reduced") => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="设置" width="md" sheetOnMobile>
      <div className="panel settings-group" style={{ marginBottom: 18 }}>
        <div className="settings-group">
          <h2>界面外观</h2>
          <div className="panel">
            <div className="setting-row">
              <div className="s-info">
                <div className="s-title">主题</div>
                <div className="s-desc">浅色 / 深色 / 跟随系统（Web 端增强项，后续并入设置页）</div>
              </div>
              <div className="control">
                <div className="seg">
                  {(["light", "dark", "system"] as const).map((t) => (
                    <button key={t} type="button" className={`seg-btn${theme === t ? " active" : ""}`} onClick={() => onChangeTheme(t)}>
                      {{ light: "浅色", dark: "深色", system: "跟随系统" }[t]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="setting-row">
              <div className="s-info">
                <div className="s-title">动画强度</div>
                <div className="s-desc">流畅 / 减弱（尊重系统“减少动态效果”偏好）</div>
              </div>
              <div className="control">
                <div className="seg">
                  {(["smooth", "reduced"] as const).map((m) => (
                    <button key={m} type="button" className={`seg-btn${motion === m ? " active" : ""}`} onClick={() => onChangeMotion(m)}>
                      {{ smooth: "流畅", reduced: "减弱" }[m]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
        <p className="small muted" style={{ padding: "0 2px" }}>
          说明：这是 P0 骨架内嵌的“界面外观”示例弹窗。完整设置页（下载 / 解析 / 附加内容 / 命名 / 高级）在 P4 接入后端配置。
        </p>
      </div>
      <div className="modal-foot">
        <div className="right">
          <button type="button" className="btn primary" onClick={onClose}>完成</button>
        </div>
      </div>
    </Modal>
  );
}