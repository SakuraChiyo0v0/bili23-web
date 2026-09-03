import { useCallback, useEffect, useRef, useState } from "react";
import type { FileEntryDTO, TaskDTO } from "./types.js";
import { STATUS_LABEL, formatBytes } from "./types.js";

const ACTIVE: Array<TaskDTO["status"]> = ["queued", "parsing", "downloading", "merging"];

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const json = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok || (json as { error?: unknown }).error) {
    throw new Error(json.error?.message ?? `请求失败（HTTP ${res.status}）`);
  }
  return json;
}

export function DownloadView({ refreshKey }: { refreshKey: number }) {
  const [tasks, setTasks] = useState<TaskDTO[]>([]);
  const [files, setFiles] = useState<FileEntryDTO[]>([]);
  const [error, setError] = useState("");
  const eventSources = useRef(new Map<string, EventSource>());

  const refreshTasks = useCallback(async () => {
    try {
      const { tasks: list } = await getJson<{ tasks: TaskDTO[] }>("/api/tasks");
      setTasks(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const refreshFiles = useCallback(async () => {
    try {
      const { files: list } = await getJson<{ files: FileEntryDTO[] }>("/api/files");
      setFiles(list);
    } catch {
      // 文件列表加载失败不打断主流程
    }
  }, []);

  // 初始 + 外部触发（解析页创建任务后切换过来）刷新
  useEffect(() => {
    void refreshTasks();
    void refreshFiles();
  }, [refreshKey, refreshTasks, refreshFiles]);

  // 为进行中的任务订阅 SSE
  useEffect(() => {
    const activeIds = new Set(tasks.filter((t) => ACTIVE.includes(t.status)).map((t) => t.id));
    for (const id of activeIds) {
      if (eventSources.current.has(id)) continue;
      const es = new EventSource(`/api/tasks/${encodeURIComponent(id)}/events`);
      eventSources.current.set(id, es);
      es.addEventListener("task", (ev) => {
        const task = JSON.parse((ev as MessageEvent).data as string) as TaskDTO;
        setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)));
        if (!ACTIVE.includes(task.status)) {
          es.close();
          eventSources.current.delete(id);
          void refreshFiles();
        }
      });
      es.onerror = () => {
        es.close();
        eventSources.current.delete(id);
      };
    }
    // 清理已不在列表里的源
    for (const [id, es] of eventSources.current) {
      if (!tasks.some((t) => t.id === id)) {
        es.close();
        eventSources.current.delete(id);
      }
    }
  }, [tasks, refreshFiles]);

  useEffect(() => () => {
    for (const es of eventSources.current.values()) es.close();
    eventSources.current.clear();
  }, []);

  const cancel = useCallback(async (id: string) => {
    await fetch(`/api/tasks/${encodeURIComponent(id)}/cancel`, { method: "POST" });
    void refreshTasks();
  }, [refreshTasks]);

  return (
    <div>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <h2>下载</h2>
        <button onClick={() => void refreshTasks()}>刷新</button>
      </div>
      {error && <p style={{ color: "#c0392b" }}>{error}</p>}
      {tasks.length === 0 ? (
        <p style={{ color: "#888" }}>暂无任务，去「解析」页粘贴链接开始下载。</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {tasks.map((t) => (
            <li key={t.id} style={{ border: "1px solid #ddd", borderRadius: 8, marginBottom: 8, padding: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span
                  style={{
                    padding: "2px 8px",
                    borderRadius: 10,
                    fontSize: 12,
                    background: statusColor(t.status),
                    color: "#fff",
                  }}
                >
                  {STATUS_LABEL[t.status]}
                </span>
                <strong style={{ flex: 1 }}>{t.title}</strong>
                <span style={{ color: "#666", fontSize: 12 }}>{t.qualityLabel}</span>
                {ACTIVE.includes(t.status) && (
                  <button onClick={() => void cancel(t.id)}>取消</button>
                )}
              </div>
              <div style={{ marginTop: 6 }}>
                <div
                  style={{
                    height: 8,
                    background: "#eee",
                    borderRadius: 4,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${Math.min(100, Math.max(0, t.progress))}%`,
                      height: "100%",
                      background: "#4f8cff",
                      transition: "width .3s",
                    }}
                  />
                </div>
                <div style={{ color: "#666", fontSize: 12, marginTop: 4 }}>
                  {t.status === "downloading"
                    ? `${t.progress.toFixed(1)}% · ${formatBytes(t.downloadedBytes)} / ${formatBytes(t.totalBytes)}`
                    : t.status === "merging"
                      ? "ffmpeg 合并/转封装中…"
                      : STATUS_LABEL[t.status]}
                </div>
              </div>
              {t.status === "failed" && t.error && (
                <p style={{ color: "#c0392b", margin: "6px 0 0", fontSize: 13 }}>{t.error}</p>
              )}
              {t.status === "completed" && t.outputPath && (
                <p style={{ margin: "6px 0 0", fontSize: 13, color: "#27ae60" }}>
                  产物：{t.outputPath}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <h2 style={{ marginTop: 24 }}>产物文件</h2>
      <button onClick={() => void refreshFiles()}>刷新文件</button>
      {files.length === 0 ? (
        <p style={{ color: "#888" }}>暂无产物。</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {files.map((f) => (
            <li key={f.path} style={{ padding: "4px 0", borderBottom: "1px solid #f0f0f0", fontSize: 14 }}>
              {f.path} · {formatBytes(f.size)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function statusColor(status: TaskDTO["status"]): string {
  switch (status) {
    case "completed":
      return "#27ae60";
    case "failed":
      return "#c0392b";
    case "downloading":
    case "merging":
    case "parsing":
      return "#4f8cff";
    case "cancelled":
      return "#95a5a6";
    default:
      return "#95a5a6";
  }
}
