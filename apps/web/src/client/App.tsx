import { useEffect, useState } from "react";
import { useTermsGate } from "./lib/useTermsGate";
import { useHashRoute, type RouteId } from "./lib/routes";
import { useToast, ToastProvider } from "./lib/toast";
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
  const { toast } = useToast();
  const [loginOpen, setLoginOpen] = useState(false);
  const auth = useAuthStore();
  useEffect(() => { void auth.refresh(); /*eslint-disable-next-line*/ }, []);


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
      <Sidebar route={route.id} onNavigate={navigate} onLogin={() => setLoginOpen(true)} loggedIn={auth.loggedIn} preview={auth.preview} uname={auth.uname} face={auth.face} mid={auth.mid} onLogout={async () => { const { logoutAuth } = await import("./services/client"); await logoutAuth(); await auth.refresh(); toast("已退出登录"); }} />
      <div className="main">
        <TopBar
          title={route.title}
          route={route.id}
          onNavigate={(id: RouteId) => navigate(id)}
          loggedIn={auth.loggedIn}
          uname={auth.uname}
          face={auth.face}
          mid={auth.mid}
          preview={auth.preview}
          onLogin={() => setLoginOpen(true)}
          onLogout={async () => { const { logoutAuth } = await import("./services/client"); await logoutAuth(); await auth.refresh(); toast("已退出登录"); }}
        />
        <main className="content">{renderPage()}</main>
        <MobileTabBar route={route.id} onNavigate={navigate} />
      </div>

      <LoginDialog open={loginOpen} onClose={() => setLoginOpen(false)} />
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

