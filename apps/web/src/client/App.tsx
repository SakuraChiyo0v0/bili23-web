import { useEffect, useState } from "react";

export function App() {
  const [health, setHealth] = useState<string>("checking…");

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((j: { ok?: boolean }) => setHealth(j.ok ? "ok" : "unexpected"))
      .catch(() => setHealth("unreachable"));
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24 }}>
      <h1>Bili23 Web</h1>
      <p>
        桌面版 Bili23-Downloader 的 TS 1:1 Web 重做版。当前为 P0 骨架，解析/下载功能随后接入。
      </p>
      <p>
        /api/health: <code>{health}</code>
      </p>
    </main>
  );
}
