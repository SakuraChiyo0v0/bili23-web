import { useState } from "react";
import { ParseView } from "./ParseView.js";
import { DownloadView } from "./DownloadView.js";
import { SettingsView } from "./SettingsView.js";
import { useI18n } from "./i18n.js";

type Tab = "parse" | "download" | "settings";

export function App() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("parse");
  const [downloadKey, setDownloadKey] = useState(0);

  const navItems: Array<{ id: Tab; label: string }> = [
    { id: "parse", label: t("nav.parse") },
    { id: "download", label: t("nav.download") },
    { id: "settings", label: t("nav.settings") },
  ];

  const goDownload = (): void => {
    setDownloadKey((k) => k + 1);
    setTab("download");
  };

  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        background: "var(--bg)",
        color: "var(--text)",
        fontFamily:
          'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
      }}
    >
      <nav
        style={{
          width: 170,
          borderRight: "1px solid var(--border)",
          background: "var(--surface)",
          padding: "20px 12px",
          flexShrink: 0,
          boxSizing: "border-box",
        }}
      >
        <h1 style={{ fontSize: 18, margin: "0 0 16px", lineHeight: 1.3, color: "var(--text)" }}>
          Bili23
          <br />
          Web
        </h1>
        {navItems.map((n) => (
          <button
            key={n.id}
            onClick={() => setTab(n.id)}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              padding: "8px 12px",
              marginBottom: 6,
              border: "none",
              borderRadius: 6,
              background: tab === n.id ? "var(--accent-soft)" : "transparent",
              color: tab === n.id ? "var(--accent)" : "var(--text-2)",
              cursor: "pointer",
              fontSize: 15,
            }}
          >
            {n.label}
          </button>
        ))}
      </nav>
      <main style={{ flex: 1, padding: 24, minWidth: 0 }}>
        {tab === "parse" ? (
          <ParseView
            onCreated={() => setDownloadKey((k) => k + 1)}
            onGoDownload={goDownload}
          />
        ) : tab === "download" ? (
          <DownloadView refreshKey={downloadKey} />
        ) : (
          <SettingsView />
        )}
      </main>
    </div>
  );
}