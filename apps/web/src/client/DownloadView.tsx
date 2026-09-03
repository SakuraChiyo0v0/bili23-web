import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { FileEntryDTO, HistoryEntryDTO, TaskDTO, TaskStatusDTO } from "./types.js";
import { formatBytes, formatDuration, formatSpeed } from "./types.js";
import { useI18n } from "./i18n.js";
import type { I18nKey } from "./i18n.js";
import {
  RefreshIcon,
  LogIcon,
  PauseIcon,
  PlayIcon,
  RetryIcon,
  TrashIcon,
  FolderIcon,
  HistoryIcon,
  DownloadIcon,
} from "./icons.js";

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
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 className="page-title">{t("dl.title")}</h1>
        <span className="topbar-spacer" />
        <button className="btn btn-ghost btn-sm" onClick={() => void refreshTasks(true)}>
          <RefreshIcon />
          {t("common.refresh")}
        </button>
      </div>

      {error && <div className="error-text">{error}</div>}

      <div className="chip-row">
        {GROUPS.map((g) => (
          <button key={g} className={`chip${group === g ? " active" : ""}`} onClick={() => setGroup(g)}>
            {t(`dl.tab.${g}`)} ({counts[g]})
          </button>
        ))}
      </div>

      {tasks.length === 0 ? (
        <div className="empty">
          <DownloadIcon size={36} />
          <p style={{ margin: "8px 0 0" }}>{t("dl.emptyAll")}</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="empty">{t("dl.emptyGroup")}</div>
      ) : (
        <ul className="item-list stagger" style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr" }}>
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

      <h2 className="page-title" style={{ marginTop: 32, fontSize: 18 }}>
        <HistoryIcon />
        {t("dl.historyTitle")}
      </h2>
      {history.length === 0 ? (
        <div className="empty">{t("dl.emptyHistory")}</div>
      ) : (
        <ul className="item-list">
          {history.map((entry) => {
            const rel = entry.outputPath ? rawRelativePath(entry.outputPath, files) : "";
            const fileName = rel ? rel.slice(rel.lastIndexOf("/") + 1) : "";
            return (
              <li key={entry.taskId}>
                <div className="row-main">
                  <div className="row-title">{entry.title}</div>
                  <div className="row-meta">
                    <span className="muted">{formatDateTime(entry.completedAt)}</span>
                    {entry.outputPath ? <span className="muted">{entry.outputPath}</span> : null}
                  </div>
                </div>
                <div className="row-actions">
                  {rel && (
                    <a className="btn btn-soft btn-sm" href={rawUrl(rel)} download={fileName} title={entry.outputPath}>
                      <DownloadIcon />
                      {t("dl.downloadFile")}
                    </a>
                  )}
                  <button className="btn btn-danger btn-sm" onClick={() => deleteHistory(entry.taskId)}>
                    <TrashIcon />
                    {t("btn.delete")}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <h2 className="page-title" style={{ marginTop: 32, fontSize: 18 }}>
        <FolderIcon />
        {t("dl.filesTitle")}
      </h2>
      <div style={{ marginBottom: 10 }}>
        <button className="btn btn-ghost btn-sm" onClick={() => void refreshFiles()}>
          <RefreshIcon />
          {t("dl.refreshFiles")}
        </button>
      </div>
      {files.length === 0 ? (
        <div className="empty">{t("dl.emptyFiles")}</div>
      ) : (
        <ul className="item-list">
          {files.map((f) => {
            const fileName = f.path.slice(f.path.lastIndexOf("/") + 1);
            return (
              <li key={f.path}>
                <a href={rawUrl(f.path)} download={fileName} className="row-main" style={{ wordBreak: "break-all", fontSize: 14 }}>
                  {f.path}
                </a>
                <span className="muted" style={{ fontSize: 13 }}>{formatBytes(f.size)}</span>
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

function badgeClass(status: TaskStatusDTO): string {
  switch (status) {
    case "completed":
      return "ok";
    case "failed":
    case "cancelled":
      return "danger";
    case "downloading":
    case "parsing":
    case "merging":
      return "active";
    default:
      return "neutral";
  }
}

function statusLabelKey(status: TaskStatusDTO): I18nKey {
  return `status.${status}` as I18nKey;
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

  const actions: Array<{ key: string; label: string; icon?: ReactNode; danger?: boolean; onClick: () => void }> = [];
  switch (task.status) {
    case "downloading":
      actions.push({ key: "pause", label: t("btn.pause"), icon: <PauseIcon />, onClick: onPause });
      actions.push({ key: "cancel", label: t("btn.cancel"), onClick: onCancel });
      break;
    case "queued":
    case "parsing":
    case "merging":
      actions.push({ key: "cancel", label: t("btn.cancel"), onClick: onCancel });
      break;
    case "paused":
    case "interrupted":
      actions.push({ key: "resume", label: t("btn.resume"), icon: <PlayIcon />, onClick: onResume });
      break;
    case "failed":
    case "cancelled":
      actions.push({ key: "retry", label: t("btn.retry"), icon: <RetryIcon />, onClick: onRetry });
      actions.push({ key: "delete", label: t("btn.delete"), icon: <TrashIcon />, danger: true, onClick: onDelete });
      break;
    case "completed":
      actions.push({ key: "delete", label: t("btn.delete"), icon: <TrashIcon />, danger: true, onClick: onDelete });
      break;
  }

  return (
    <li className="task-card">
      <div className="task-head">
        <span className={`badge ${badgeClass(task.status)}`}>{t(statusLabelKey(task.status))}</span>
        <strong className="task-title">{task.title}</strong>
        {task.qualityLabel ? <span className="muted" style={{ fontSize: 12 }}>{task.qualityLabel}</span> : null}
        <div className="task-actions">
          {actions.map((a) => (
            <button key={a.key} className={a.danger ? "btn btn-danger btn-sm" : "btn btn-ghost btn-sm"} onClick={a.onClick}>
              {a.icon}
              {a.label}
            </button>
          ))}
          <button className="btn btn-ghost btn-sm" onClick={onToggleLog}>
            <LogIcon />
            {logOpen ? t("dl.logHide") : t("dl.log")}
          </button>
        </div>
      </div>

      <div className="progress">
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="task-meta">
        {task.status === "downloading" ? (
          <>
            <span>{progressText}</span>
            {speedText ? <span className="tag brand">{speedText}</span> : null}
            {etaText ? <span>{etaText}</span> : null}
          </>
        ) : task.status === "merging" ? (
          <span>{t("dl.mergingText")}</span>
        ) : (
          <span>{t(statusLabelKey(task.status))}</span>
        )}
      </div>

      {task.status === "interrupted" && task.error && (
        <p className="error-text" style={{ margin: "6px 0 0" }}>{task.error}</p>
      )}
      {task.status === "failed" && task.error && (
        <p className="error-text" style={{ margin: "6px 0 0" }}>{task.error}</p>
      )}
      {task.status === "completed" && task.outputPath && (
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--text-2)", wordBreak: "break-all" }}>
          {t("dl.output", { path: task.outputPath })}
          {rel && (
            <>
              {" "}
              <a className="btn btn-soft btn-sm" href={rawUrl(rel)} download={fileName}>
                <DownloadIcon />
                {t("dl.downloadFile")}
              </a>
            </>
          )}
        </p>
      )}

      {logOpen && (
        <div className="log-box">
          {logLoading ? (
            <span className="muted">{t("dl.logLoading")}</span>
          ) : logErr ? (
            <span className="error-text">{logErr}</span>
          ) : logLines && logLines.length > 0 ? (
            <pre>{logLines.join("\n")}</pre>
          ) : (
            <span className="muted">{t("dl.logEmpty")}</span>
          )}
        </div>
      )}
    </li>
  );
}
