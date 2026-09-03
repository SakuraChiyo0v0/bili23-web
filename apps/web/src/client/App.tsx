import { useState } from "react";
import { ParseView } from "./ParseView.js";
import { DownloadView } from "./DownloadView.js";

type Tab = "parse" | "download";

const NAV: Array<{ id: Tab; label: string }> = [
  { id: "parse", label: "解析" },
  { id: "download", label: "下载" },
];

export function App() {
  const [tab, setTab] = useState<Tab>("parse");
  const [downloadKey, setDownloadKey] = useState(0);

  const goDownload = (): void => {
    setDownloadKey((k) => k + 1);
    setTab("download");
  };

  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        fontFamily:
          'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
      }}
    >
      <nav
        style={{
          width: 160,
          borderRight: "1px solid #e5e5e5",
          padding: "20px 12px",
          flexShrink: 0,
          boxSizing: "border-box",
        }}
      >
        <h1 style={{ fontSize: 18, margin: "0 0 16px", lineHeight: 1.3 }}>
          Bili23
          <br />
          Web
        </h1>
        {NAV.map((n) => (
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
              background: tab === n.id ? "#e8f0fe" : "transparent",
              color: tab === n.id ? "#1a56db" : "#333",
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
          <ParseView onCreated={() => setDownloadKey((k) => k + 1)} onGoDownload={goDownload} />
        ) : (
          <DownloadView refreshKey={downloadKey} />
        )}
      </main>
    </div>
  );
}
