import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import type { FileEntry, HistoryEntryDto, TaskStatus, TaskSummary } from "../types.js";
import { Icon } from "../components/icons.js";
import { cn, formatBytes, formatEta, formatSpeed, formatTime, STATUS_LABELS, STATUS_TONES } from "../utils.js";

interface TasksViewProps {
  onToast: (message: string, tone?: "success" | "error") => void;
}

type Tab = "tasks" | "history" | "files";

const ACTIVE_STATUSES = new Set<TaskStatus>(["queued", "parsing", "downloading", "merging"]);
const RESUMABLE_STATUSES = new Set<TaskStatus>(["paused", "interrupted", "failed", "cancelled"]);
const RETRYABLE_STATUSES = new Set<TaskStatus>(["failed", "cancelled"]);

function StatusBadge({ status }: { status: TaskStatus }) {
  return <span className={cn("status-badge", `status-${STATUS_TONES[status]}`)}>{STATUS_LABELS[status]}</span>;
}

function TaskCard({ task, onAction, onLog }: { task: TaskSummary; onAction: (action: "pause" | "resume" | "retry" | "cancel" | "delete", id: string) => void; onLog: (id: string) => void }) {
  const progress = Math.max(0, Math.min(100, task.progress || 0));
  return (
    <article className="task-card">
      <div className="task-card-top">
        <div className="task-title-block">
          <StatusBadge status={task.status} />
          <h3>{task.title}</h3>
          <p>{task.groupTitle} · {task.qualityLabel}</p>
        </div>
        <div className="task-actions">
          {ACTIVE_STATUSES.has(task.status) ? (
            <button className="icon-button" type="button" title="暂停" onClick={() => onAction("pause", task.id)}><Icon name="pause" size={16} /></button>
          ) : null}
          {RESUMABLE_STATUSES.has(task.status) ? (
            <button className="icon-button" type="button" title="继续" onClick={() => onAction("resume", task.id)}><Icon name="play" size={16} /></button>
          ) : null}
          {RETRYABLE_STATUSES.has(task.status) ? (
            <button className="icon-button" type="button" title="重试" onClick={() => onAction("retry", task.id)}><Icon name="retry" size={16} /></button>
          ) : null}
          {ACTIVE_STATUSES.has(task.status) ? (
            <button className="icon-button" type="button" title="取消" onClick={() => onAction("cancel", task.id)}><Icon name="close" size={16} /></button>
          ) : null}
          <button className="icon-button" type="button" title="查看日志" onClick={() => onLog(task.id)}><Icon name="log" size={16} /></button>
          <button className="icon-button icon-button-danger" type="button" title="删除任务" onClick={() => onAction("delete", task.id)}><Icon name="trash" size={16} /></button>
        </div>
      </div>
      <div className="task-progress">
        <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
        <div className="progress-meta"><strong>{progress.toFixed(1)}%</strong><span>{formatBytes(task.downloadedBytes)} / {formatBytes(task.totalBytes)}</span><span>{formatSpeed(task.speedBps)}</span><span>剩余 {formatEta(task.etaSec)}</span></div>
      </div>
      {task.error ? <div className="task-error"><Icon name="info" size={15} /> {task.error}</div> : null}
      {task.outputPath ? <div className="task-output"><Icon name="folder" size={15} /> {task.outputPath}</div> : null}
    </article>
  );
}

export function TasksView({ onToast }: TasksViewProps) {
  const [tab, setTab] = useState<Tab>("tasks");
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [history, setHistory] = useState<HistoryEntryDto[]>([]);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [logs, setLogs] = useState<{ id: string; lines: string[] }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const activeIds = useMemo(() => tasks.filter((task) => ACTIVE_STATUSES.has(task.status)).map((task) => task.id).join(","), [tasks]);

  const loadTasks = useCallback(async () => {
    try {
      setTasks(await api.listTasks());
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "任务列表加载失败");
    }
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    await Promise.all([
      loadTasks(),
      api.listHistory().then(setHistory).catch(() => history),
      api.listFiles().then(setFiles).catch(() => files),
    ]);
    setLoading(false);
  }, [loadTasks]);

  useEffect(() => {
    void loadData();
    const timer = window.setInterval(() => void loadTasks(), 3000);
    return () => window.clearInterval(timer);
  }, [loadData, loadTasks]);

  useEffect(() => {
    const ids = activeIds.split(",").filter(Boolean);
    if (ids.length === 0) return;
    const closeHandlers = ids.map((id) => api.openTaskEvents(id, (task) => setTasks((current) => current.map((entry) => entry.id === task.id ? task : entry))));
    return () => closeHandlers.forEach((close) => close());
  }, [activeIds]);

  const runAction = async (action: "pause" | "resume" | "retry" | "cancel" | "delete", id: string) => {
    try {
      if (action === "pause") await api.pauseTask(id);
      if (action === "resume") await api.resumeTask(id);
      if (action === "retry") await api.retryTask(id);
      if (action === "cancel") await api.cancelTask(id);
      if (action === "delete") {
        if (!window.confirm("确定删除这个任务吗？临时文件和任务记录会一起删除。")) return;
        await api.deleteTask(id);
      }
      await loadTasks();
      onToast(action === "delete" ? "任务已删除" : "操作已提交", "success");
    } catch (err) {
      onToast(err instanceof Error ? err.message : "操作失败", "error");
    }
  };

  const openLog = async (id: string) => {
    try {
      setLogs({ id, lines: await api.taskLog(id) });
    } catch (err) {
      onToast(err instanceof Error ? err.message : "日志加载失败", "error");
    }
  };

  const counts = {
    all: tasks.length,
    active: tasks.filter((task) => ACTIVE_STATUSES.has(task.status)).length,
    completed: tasks.filter((task) => task.status === "completed").length,
    failed: tasks.filter((task) => task.status === "failed").length,
  };

  return (
    <div className="view-stack">
      <section className="hero-panel hero-panel-small">
        <div className="hero-copy"><p className="eyebrow">DOWNLOAD CENTER</p><h1>下载中心 <em>实时掌握进度。</em></h1><p className="hero-description">任务、历史和产物文件都在这里。任务进度会自动刷新，也可以直接暂停、继续、重试。</p></div>
        <div className="hero-stat"><strong>{counts.active}</strong><span>进行中任务</span></div>
      </section>

      <div className="content-tabs" role="tablist">
        <button type="button" className={cn("content-tab", tab === "tasks" && "is-active")} onClick={() => setTab("tasks")}><Icon name="download" size={16} /> 任务 <span>{counts.all}</span></button>
        <button type="button" className={cn("content-tab", tab === "history" && "is-active")} onClick={() => setTab("history")}><Icon name="history" size={16} /> 历史 <span>{history.length}</span></button>
        <button type="button" className={cn("content-tab", tab === "files" && "is-active")} onClick={() => setTab("files")}><Icon name="folder" size={16} /> 文件 <span>{files.length}</span></button>
        <button className="button button-ghost refresh-button" type="button" onClick={() => void loadData()}><Icon name="retry" size={15} /> 刷新</button>
      </div>

      {error ? <div className="inline-error"><Icon name="info" size={16} /> {error}</div> : null}

      {tab === "tasks" ? (
        <section className="tasks-panel">
          <div className="summary-row">
            <div><span className="summary-number">{counts.all}</span><span>全部任务</span></div>
            <div><span className="summary-number">{counts.active}</span><span>进行中</span></div>
            <div><span className="summary-number">{counts.completed}</span><span>已完成</span></div>
            <div><span className="summary-number">{counts.failed}</span><span>失败</span></div>
          </div>
          {loading && tasks.length === 0 ? <div className="loading-panel"><span className="skeleton-line" /><span className="skeleton-line" /><span className="skeleton-line" /></div> : null}
          {!loading && tasks.length === 0 ? <div className="empty-inline"><Icon name="download" size={24} /><strong>还没有下载任务</strong><span>去「解析」页面选择内容后创建任务。</span></div> : null}
          <div className="task-list">{tasks.map((task) => <TaskCard key={task.id} task={task} onAction={runAction} onLog={openLog} />)}</div>
        </section>
      ) : null}

      {tab === "history" ? (
        <section className="list-panel">
          {history.length === 0 ? <div className="empty-inline"><Icon name="history" size={24} /><strong>还没有完成记录</strong><span>完成的下载会出现在这里。</span></div> : null}
          <div className="data-list">{history.map((entry) => (
            <div className="data-row" key={entry.taskId}>
              <div className="data-row-icon"><Icon name="check" size={16} /></div>
              <div className="data-row-main"><strong>{entry.title}</strong><span>{entry.outputPath || "已保存到下载目录"}</span></div>
              <time>{formatTime(entry.completedAt)}</time>
              <button className="icon-button icon-button-danger" type="button" aria-label="删除历史" onClick={async () => { await api.deleteHistory(entry.taskId); setHistory((current) => current.filter((item) => item.taskId !== entry.taskId)); }}><Icon name="trash" size={16} /></button>
            </div>
          ))}</div>
        </section>
      ) : null}

      {tab === "files" ? (
        <section className="list-panel">
          {files.length === 0 ? <div className="empty-inline"><Icon name="folder" size={24} /><strong>下载目录还是空的</strong><span>任务完成后，文件会出现在这里。</span></div> : null}
          <div className="data-list">{files.map((entry) => (
            <div className="data-row" key={entry.path}>
              <div className="data-row-icon"><Icon name="folder" size={16} /></div>
              <div className="data-row-main"><strong>{entry.name}</strong><span>{entry.path}</span></div>
              <span className="file-size">{formatBytes(entry.size)}</span>
              <a className="icon-button" href={api.fileUrl(entry.path)} download aria-label="下载文件"><Icon name="download" size={16} /></a>
            </div>
          ))}</div>
        </section>
      ) : null}

      {logs ? (
        <div className="drawer-backdrop" role="presentation" onClick={() => setLogs(undefined)}>
          <section className="log-drawer" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className="drawer-header"><div><p className="eyebrow">TASK LOG</p><h2>任务日志</h2></div><button className="icon-button" type="button" onClick={() => setLogs(undefined)}><Icon name="close" /></button></header>
            <div className="log-lines">{logs.lines.length === 0 ? <span>暂无日志</span> : logs.lines.map((line, index) => <code key={`${line}-${index}`}>{line}</code>)}</div>
          </section>
        </div>
      ) : null}
    </div>
  );
}