import { useCallback, useEffect, useRef, useState } from "react";
import type { FileEntryDTO, HistoryEntryDTO, TaskDTO, TaskStatusDTO } from "./types.js";
import { formatBytes, formatDuration, formatSpeed } from "./types.js";
import { useI18n } from "./i18n.js";
import type { I18nKey } from "./i18n.js";

/** 需要 SSE / 轮询兜底的“仍在推进”状态 */
const RUNNING: TaskStatusDTO[] = ["queued", "parsing", "downloading", "merging"];
const TERMINAL: TaskStatusDTO[] = ["completed", "failed", "cancelled"];

type GroupKey = "all" | "active" | "done" | "failed";

const GROUPS: GroupKey[] = ["all", "active", "done", "failed"];

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const json = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok || (json as { error?: unknown }).error) {
    throw new Error(json.error?.message ?? `HTTP ${res.status}`);
  }
  return json;
}

async function postAction(url: string): Promise<void> {
  const res = await fetch(url, { method: "POST" });
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!res.ok) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
}

function isRunning(status: TaskStatusDTO): boolean {
  return RUNNING.includes(status);
}

function isTerminal(status: TaskStatusDTO): boolean {
  return TERMINAL.includes(status);
}

/** 从 outputPath（可能是绝对路径，含 Windows 反斜杠）推导相对下载根的路径。 */
function rawRelativePath(outputPath: string, files: FileEntryDTO[]): string {
  const norm = outputPath.replace(/\\/g, "/");
  const exact = files.find((f) => norm === f.path || norm.endsWith(`/${f.path}`));
  if (exact) return exact.path;
  const fileName = norm.slice(norm.lastIndexOf("/") + 1);
  if (!fileName) return "";
  const byName = files.filter((f) => f.path === fileName || f.path.endsWith(`/${fileName}`));
  const first = byName[0];
  return byName.length === 1 && first ? first.path : fileName;
}

function rawUrl(rel: string): string {
  return `/api/files/raw?path=${encodeURIComponent(rel)}`;
}

function formatDateTime(ts: number): string {
  if (!ts) return "";
  // completedAt/createdAt 可能是秒或毫秒，按量级猜测
  const ms = ts < 1e12 ? ts * 1000 : ts;
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function DownloadView({ refreshKey }: { refreshKey: number }) {
  const { t } = useI18n();
  const [tasks, setTasks] = useState<TaskDTO[]>([]);
  const [files, setFiles] = useState<FileEntryDTO[]>([]);
  const [history, setHistory] = useState<HistoryEntryDTO[]>([]);
  const [group, setGroup] = useState<GroupKey>("all");
  const [error, setError] = useState("");
  const [logOpen, setLogOpen] = useState<Record<string, boolean>>({});
  const [logLines, setLogLines] = useState<Record<string, string[]>>({});
  const [logLoading, setLogLoading] = useState<Record<string, boolean>>({});
  const [logErr, setLogErr] = useState<Record<string, string>>({});

  const eventSources = useRef(new Map<string, EventSource>());
  /** 最近一次已知状态快照（用于轮询时发现漏掉的终态切换） */
  const snapshotRef = useRef<Map<string, TaskStatusDTO>>(new Map());

  const setErrorOnce = useCallback((e: unknown): void => {
    const msg = e instanceof Error ? e.message : String(e);
    setError((prev) => (prev === msg ? prev : msg));
  }, []);

  const commitTasks = useCallback((list: TaskDTO[]): void => {
    setTasks(list);
    snapshotRef.current = new Map(list.map((task) => [task.id, task.status]));
  }, []);

  const refreshFiles = useCallback(async (): Promise<void> => {
    try {
      const { files: list } = await getJson<{ files: FileEntryDTO[] }>("/api/files");
      setFiles(list);
    } catch {
      // 文件列表加载失败不打断主流程
    }
  }, []);

  const refreshHistory = useCallback(async (): Promise<void> => {
    try {
      const { history: list } = await getJson<{ history: HistoryEntryDTO[] }>("/api/history");
      setHistory(list);
    } catch {
      // 历史加载失败不打断主流程
    }
  }, []);

  const refreshTasks = useCallback(
    async (showError = false): Promise<TaskDTO[]> => {
      try {
        const { tasks: list } = await getJson<{ tasks: TaskDTO[] }>("/api/tasks");
        commitTasks(list);
        return list;
      } catch (e) {
        if (showError) setErrorOnce(e);
        return [];
      }
    },
    [commitTasks, setErrorOnce],
  );

  // 初始 + 外部触发（解析页创建任务后切换过来）刷新
  useEffect(() => {
    void refreshTasks(true);
    void refreshFiles();
    void refreshHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // 为进行中的任务订阅 SSE
  useEffect(() => {
    const activeIds = new Set(tasks.filter((task) => RUNNING.includes(task.status)).map((task) => task.id));
    for (const id of activeIds) {
      if (eventSources.current.has(id)) continue;
      const es = new EventSource(`/api/tasks/${encodeURIComponent(id)}/events`);
      eventSources.current.set(id, es);
      es.addEventListener("task", (ev) => {
        const task = JSON.parse((ev as MessageEvent).data as string) as TaskDTO;
        setTasks((prev) => prev.map((existing) => (existing.id === task.id ? task : existing)));
        if (isTerminal(task.status)) {
          es.close();
          eventSources.current.delete(id);
          void refreshFiles();
          void refreshHistory();
        }
      });
      es.onerror = () => {
        es.close();
        eventSources.current.delete(id);
      };
    }
    // 清理已不在列表里的源
    for (const [id, es] of eventSources.current) {
      if (!tasks.some((task) => task.id === id)) {
        es.close();
        eventSources.current.delete(id);
      }
    }
  }, [tasks, refreshFiles, refreshHistory]);

  // 卸载时关闭全部 SSE
  useEffect(
    () => () => {
      for (const es of eventSources.current.values()) es.close();
      eventSources.current.clear();
    },
    [],
  );

  // 存在进行中任务时每 5s 轮询兜底（SSE 断连/队列增减/状态推进）
  useEffect(() => {
    const anyRunning = tasks.some((task) => RUNNING.includes(task.status));
    if (!anyRunning) return;
    const timer = window.setInterval(() => {
      void (async () => {
        const prev = snapshotRef.current;
        const list = await refreshTasks(false);
        let changedToTerminal = false;
        for (const task of list) {
          const before = prev.get(task.id);
          if (before && before !== task.status && isTerminal(task.status)) changedToTerminal = true;
        }
        if (changedToTerminal) {
          void refreshFiles();
          void refreshHistory();
        }
      })();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [tasks, refreshTasks, refreshFiles, refreshHistory]);

  const runAction = useCallback(
    async (action: () => Promise<void>) => {
      setError("");
      try {
        await action();
      } catch (e) {
        setErrorOnce(e);
      }
    },
    [setErrorOnce],
  );

  const pauseTask = (id: string): void => {
    void runAction(async () => {
      await postAction(`/api/tasks/${encodeURIComponent(id)}/pause`);
      await refreshTasks(false);
    });
  };
  const resumeTask = (id: string): void => {
    void runAction(async () => {
      await postAction(`/api/tasks/${encodeURIComponent(id)}/resume`);
      await refreshTasks(false);
    });
  };
  const retryTask = (id: string): void => {
    void runAction(async () => {
      await postAction(`/api/tasks/${encodeURIComponent(id)}/retry`);
      await refreshTasks(false);
    });
  };
  const cancelTask = (id: string): void => {
    void runAction(async () => {
      await postAction(`/api/tasks/${encodeURIComponent(id)}/cancel`);
      await refreshTasks(false);
      await refreshFiles();
    });
  };
  const deleteTask = (id: string): void => {
    void runAction(async () => {
      await postAction(`/api/tasks/${encodeURIComponent(id)}/delete`);
      await refreshTasks(false);
      await refreshFiles();
      await refreshHistory();
    });
  };
  const deleteHistory = (taskId: string): void => {
    void runAction(async () => {
      const res = await fetch(`/api/history/${encodeURIComponent(taskId)}`, { method: "DELETE" });
      const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
      await refreshHistory();
      await refreshTasks(false);
    });
  };

  const toggleLog = useCallback(
    (id: string): void => {
      const open = logOpen[id] ?? false;
      setLogOpen((prev) => ({ ...prev, [id]: !open }));
      if (open || logLines[id] || logLoading[id]) return;
      setLogLoading((prev) => ({ ...prev, [id]: true }));
      setLogErr((prev) => ({ ...prev, [id]: "" }));
      void (async () => {
        try {
          const { lines } = await getJson<{ lines: string[] }>(`/api/tasks/${encodeURIComponent(id)}/log`);
          setLogLines((prev) => ({ ...prev, [id]: lines }));
        } catch (e) {
          setLogErr((prev) => ({ ...prev, [id]: e instanceof Error ? e.message : String(e) }));
        } finally {
          setLogLoading((prev) => ({ ...prev, [id]: false }));
        }
      })();
    },
    [logOpen, logLines, logLoading],
  );

  const counts: Record<GroupKey, number> = {
    all: tasks.length,
    active: tasks.filter((task) => groupOf(task.status) === "active").length,
    done: tasks.filter((task) => groupOf(task.status) === "done").length,
    failed: tasks.filter((task) => groupOf(task.status) === "failed").length,
  };

  const visible = group === "all" ? tasks : tasks.filter((task) => groupOf(task.status) === group);

  return (
    <div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>{t("dl.title")}</h2>
        <button onClick={() => void refreshTasks(true)}>{t("common.refresh")}</button>
      </div>
      {error && <p style={{ color: "var(--danger)", margin: "8px 0 0" }}>{error}</p>}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "12px 0" }}>
        {GROUPS.map((g) => (
          <button
            key={g}
            onClick={() => setGroup(g)}
            style={{
              padding: "5px 12px",
              borderRadius: 14,
              border: "1px solid var(--border)",
              background: group === g ? "var(--accent-soft)" : "var(--surface)",
              color: group === g ? "var(--accent)" : "var(--text-2)",
              cursor: "pointer",
            }}
          >
            {t(`dl.tab.${g}`)} ({counts[g]})
          </button>
        ))}
      </div>

      {tasks.length === 0 ? (
        <p style={{ color: "var(--text-3)" }}>{t("dl.emptyAll")}</p>
      ) : visible.length === 0 ? (
        <p style={{ color: "var(--text-3)" }}>{t("dl.emptyGroup")}</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {visible.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              files={files}
              logOpen={logOpen[task.id] ?? false}
              logLines={logLines[task.id]}
              logLoading={logLoading[task.id] ?? false}
              logErr={logErr[task.id] ?? ""}
              onPause={() => pauseTask(task.id)}
              onResume={() => resumeTask(task.id)}
              onRetry={() => retryTask(task.id)}
              onCancel={() => cancelTask(task.id)}
              onDelete={() => deleteTask(task.id)}
              onToggleLog={() => toggleLog(task.id)}
            />
          ))}
        </ul>
      )}

      <h2 style={{ marginTop: 28 }}>{t("dl.historyTitle")}</h2>
      {history.length === 0 ? (
        <p style={{ color: "var(--text-3)" }}>{t("dl.emptyHistory")}</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {history.map((entry) => {
            const rel = entry.outputPath ? rawRelativePath(entry.outputPath, files) : "";
            const fileName = rel ? rel.slice(rel.lastIndexOf("/") + 1) : "";
            return (
              <li
                key={entry.taskId}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  marginBottom: 8,
                  padding: 10,
                  background: "var(--surface)",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{entry.title}</div>
                  <div style={{ color: "var(--text-3)", fontSize: 12, marginTop: 2 }}>
                    {formatDateTime(entry.completedAt)}
                    {entry.outputPath ? ` · ${entry.outputPath}` : ""}
                  </div>
                </div>
                {rel && (
                  <a href={rawUrl(rel)} download={fileName} title={entry.outputPath}>
                    {t("dl.downloadFile")}
                  </a>
                )}
                <button onClick={() => deleteHistory(entry.taskId)}>{t("btn.delete")}</button>
              </li>
            );
          })}
        </ul>
      )}

      <h2 style={{ marginTop: 28 }}>{t("dl.filesTitle")}</h2>
      <div style={{ marginBottom: 8 }}>
        <button onClick={() => void refreshFiles()}>{t("dl.refreshFiles")}</button>
      </div>
      {files.length === 0 ? (
        <p style={{ color: "var(--text-3)" }}>{t("dl.emptyFiles")}</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {files.map((f) => {
            const fileName = f.path.slice(f.path.lastIndexOf("/") + 1);
            return (
              <li
                key={f.path}
                style={{
                  padding: "4px 0",
                  borderBottom: "1px solid var(--border)",
                  fontSize: 14,
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <a href={rawUrl(f.path)} download={fileName} style={{ flex: 1, minWidth: 0, wordBreak: "break-all" }}>
                  {f.path}
                </a>
                <span style={{ color: "var(--text-3)" }}>{formatBytes(f.size)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function groupOf(status: TaskStatusDTO): GroupKey {
  if (status === "completed") return "done";
  if (status === "failed" || status === "cancelled") return "failed";
  return "active";
}

function statusBadge(status: TaskStatusDTO): string {
  switch (status) {
    case "completed":
      return "var(--badge-ok)";
    case "failed":
      return "var(--badge-danger)";
    case "downloading":
    case "parsing":
    case "merging":
      return "var(--badge-active)";
    default:
      return "var(--badge-neutral)";
  }
}

function TaskCard(props: {
  task: TaskDTO;
  files: FileEntryDTO[];
  logOpen: boolean;
  logLines: string[] | undefined;
  logLoading: boolean;
  logErr: string;
  onPause: () => void;
  onResume: () => void;
  onRetry: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onToggleLog: () => void;
}) {
  const { task, files, logOpen, logLines, logLoading, logErr, onPause, onResume, onRetry, onCancel, onDelete, onToggleLog } =
    props;
  const { t } = useI18n();
  const pct = Math.min(100, Math.max(0, task.progress));
  const progressText = `${pct.toFixed(1)}% · ${formatBytes(task.downloadedBytes)} / ${formatBytes(task.totalBytes)}`;
  const speedText = task.status === "downloading" && task.speedBps ? formatSpeed(task.speedBps) : "";
  const etaText =
    task.status === "downloading" && task.etaSec !== undefined && task.etaSec > 0
      ? t("dl.eta", { time: formatDuration(task.etaSec) })
      : "";
  const rel = task.outputPath ? rawRelativePath(task.outputPath, files) : "";
  const fileName = rel ? rel.slice(rel.lastIndexOf("/") + 1) : "";

  const actions: Array<{ key: string; label: string; danger?: boolean; onClick: () => void }> = [];
  switch (task.status) {
    case "downloading":
      actions.push(
        { key: "pause", label: t("btn.pause"), onClick: onPause },
        { key: "cancel", label: t("btn.cancel"), onClick: onCancel },
      );
      break;
    case "queued":
    case "parsing":
    case "merging":
      actions.push({ key: "cancel", label: t("btn.cancel"), onClick: onCancel });
      break;
    case "paused":
    case "interrupted":
      actions.push({ key: "resume", label: t("btn.resume"), onClick: onResume });
      break;
    case "failed":
    case "cancelled":
      actions.push(
        { key: "retry", label: t("btn.retry"), onClick: onRetry },
        { key: "delete", label: t("btn.delete"), danger: true, onClick: onDelete },
      );
      break;
    case "completed":
      actions.push({ key: "delete", label: t("btn.delete"), danger: true, onClick: onDelete });
      break;
  }

  return (
    <li
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        marginBottom: 8,
        padding: 10,
        background: "var(--surface)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span
          style={{
            padding: "2px 8px",
            borderRadius: 10,
            fontSize: 12,
            fontWeight: 600,
            background: statusBadge(task.status),
            color: "#fff",
          }}
        >
          {t(`status.${task.status}` as I18nKey)}
        </span>
        <strong style={{ flex: 1, minWidth: 120, color: "var(--text)" }}>{task.title}</strong>
        <span style={{ color: "var(--text-2)", fontSize: 12 }}>{task.qualityLabel}</span>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {actions.map((a) => (
            <button
              key={a.key}
              onClick={a.onClick}
              style={
                a.danger
                  ? { color: "var(--danger)", borderColor: "var(--border-strong)", background: "var(--surface)" }
                  : { background: "var(--surface)", color: "var(--text)" }
              }
            >
              {a.label}
            </button>
          ))}
          <button onClick={onToggleLog} style={{ background: "var(--surface)", color: "var(--text-2)" }}>
            {logOpen ? t("dl.logHide") : t("dl.log")}
          </button>
        </div>
      </div>

      <div style={{ marginTop: 6 }}>
        <div style={{ height: 8, background: "var(--track)", borderRadius: 4, overflow: "hidden" }}>
          <div
            style={{
              width: `${pct}%`,
              height: "100%",
              background: "var(--accent)",
              transition: "width .3s",
            }}
          />
        </div>
        <div style={{ color: "var(--text-2)", fontSize: 12, marginTop: 4 }}>
          {task.status === "downloading" ? (
            <>
              {progressText}
              {speedText ? ` · ${speedText}` : ""}
              {etaText ? ` · ${etaText}` : ""}
            </>
          ) : task.status === "merging" ? (
            t("dl.mergingText")
          ) : (
            t(`status.${task.status}` as I18nKey)
          )}
        </div>
      </div>

      {task.status === "interrupted" && task.error && (
        <p style={{ color: "var(--danger)", margin: "6px 0 0", fontSize: 13 }}>{task.error}</p>
      )}
      {task.status === "failed" && task.error && (
        <p style={{ color: "var(--danger)", margin: "6px 0 0", fontSize: 13 }}>{task.error}</p>
      )}
      {task.status === "completed" && task.outputPath && (
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--text-2)", wordBreak: "break-all" }}>
          {t("dl.output", { path: task.outputPath })}
          {rel && (
            <>
              {" "}
              <a href={rawUrl(rel)} download={fileName}>
                {t("dl.downloadFile")}
              </a>
            </>
          )}
        </p>
      )}

      {logOpen && (
        <div
          style={{
            marginTop: 8,
            padding: 8,
            background: "var(--surface-2)",
            borderRadius: 6,
            border: "1px solid var(--border)",
            fontSize: 12,
          }}
        >
          {logLoading ? (
            <span style={{ color: "var(--text-3)" }}>{t("dl.logLoading")}</span>
          ) : logErr ? (
            <span style={{ color: "var(--danger)" }}>{logErr}</span>
          ) : logLines && logLines.length > 0 ? (
            <pre
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
                maxHeight: 220,
                overflow: "auto",
                color: "var(--text-2)",
                fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
              }}
            >
              {logLines.join("\n")}
            </pre>
          ) : (
            <span style={{ color: "var(--text-3)" }}>{t("dl.logEmpty")}</span>
          )}
        </div>
      )}
    </li>
  );
}