import { useState, type ReactNode } from 'react';
import { ParseView } from "./ParseView.js";
import { DownloadView } from "./DownloadView.js";
import { SettingsView } from "./SettingsView.js";
import { useI18n } from "./i18n.js";
import { useTheme } from "./theme.js";
import {
  LogoIcon,
  SearchIcon,
  DownloadIcon,
  SettingsIcon,
  SunIcon,
  MoonIcon,
} from "./icons.js";

type Tab = "parse" | "download" | "settings";

export function App() {
  const { t } = useI18n();
  const { pref: themePref, resolved, setPref: setThemePref } = useTheme();
  const [tab, setTab] = useState<Tab>("parse");
  const [downloadKey, setDownloadKey] = useState(0);

  const navItems: Array<{ id: Tab; label: string; icon: ReactNode }> = [
    { id: "parse", label: t("nav.parse"), icon: <SearchIcon /> },
    { id: "download", label: t("nav.download"), icon: <DownloadIcon /> },
    { id: "settings", label: t("nav.settings"), icon: <SettingsIcon /> },
  ];

  const goDownload = (): void => {
    setDownloadKey((k) => k + 1);
    setTab("download");
  };

  const toggleTheme = (): void => {
    setThemePref(resolved === "dark" ? "light" : "dark");
  };

  return (
    <div className="app">
      {/* 顶部 AppBar */}
      <header className="topbar">
        <div className="logo">
          <span className="logo-badge">
            <LogoIcon />
          </span>
          <span>Bili23 Web</span>
        </div>
        <nav className="topnav">
          {navItems.map((n) => (
            <button
              key={n.id}
              className={`nav-link${tab === n.id ? " active" : ""}`}
              onClick={() => setTab(n.id)}
            >
              {n.icon}
              {n.label}
            </button>
          ))}
        </nav>
        <div className="topbar-spacer" />
        <button
          className="icon-btn"
          onClick={toggleTheme}
          title={resolved === "dark" ? t("settings.behavior.theme.light") : t("settings.behavior.theme.dark")}
        >
          {resolved === "dark" ? <SunIcon /> : <MoonIcon />}
        </button>
      </header>

      {/* 主内容 */}
      <main className="main">
        <div className="page-enter" key={tab}>
          {tab === "parse" ? (
            <ParseView
              onCreated={() => setDownloadKey((k) => k + 1)}
              onGoDownload={goDownload}
              onGoSettings={() => setTab("settings")}
            />
          ) : tab === "download" ? (
            <DownloadView refreshKey={downloadKey} onGoParse={() => setTab("parse")} />
          ) : (
            <SettingsView />
          )}
        </div>
      </main>

      {/* 移动底部 TabBar */}
      <nav className="bottom-tabbar">
        {navItems.map((n) => (
          <button
            key={n.id}
            className={`tab-btn${tab === n.id ? " active" : ""}`}
            onClick={() => setTab(n.id)}
          >
            {n.icon}
            <span>{n.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
