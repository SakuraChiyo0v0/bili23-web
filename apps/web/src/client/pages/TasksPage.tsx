import { useEffect, useMemo } from "react";
import { subscribeTaskEvents, pauseTask, resumeTask, deleteTask } from "../services/client";
import {
  useTasksStore, isDownloading, isCompleted, TASK_STATUS_META, type TaskTab,
} from "../store/useTasksStore";
import { Icon } from "../lib/icons";
import { useToast } from "../lib/toast";
import type { TaskSummary } from "../services/types";
import { TaskActions } from "../components/TaskActions";

export function TasksPage() {
  const { tasks, activeTab, loading, error, setTab, refresh, upsert, remove } = useTasksStore();
  const { toast } = useToast();

  // 进入页面拉取全量
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 订阅仍在进行中任务的 SSE
  useEffect(() => {
    const closers: Array<() => void> = [];
    for (const t of tasks) {
      if (!isCompleted(t)) {
        const close = subscribeTaskEvents(t.id, (updated) => upsert(updated));
        closers.push(close);
      }
    }
    return () => closers.forEach((c) => c());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks.map((t) => t.id).join("|")]);

  // 下载中/已完成 双页签列表
  const downloading = useMemo(() => tasks.filter(isDownloading), [tasks]);
  const completed = useMemo(() => tasks.filter(isCompleted), [tasks]);

  const count = (t: TaskTab) => (t === "downloading" ? downloading.length : completed.length);

  const pauseAll = async () => {
    const targets = downloading.filter((t) => ["downloading", "queued", "parsing", "merging"].includes(t.status));
    await Promise.all(targets.map((t) => pauseTask(t.id).catch(() => null)));
    await refresh();
    toast(`已暂停 ${targets.length} 个任务`, "ok");
  };
  const resumeAll = async () => {
    const targets = downloading.filter((t) => ["paused", "interrupted"].includes(t.status));
    await Promise.all(targets.map((t) => resumeTask(t.id).catch(() => null)));
    await refresh();
    toast(`已继续 ${targets.length} 个任务`, "ok");
  };
  const clearCompleted = async () => {
    await Promise.all(completed.map((t) => deleteTask(t.id).catch(() => null)));
    await refresh();
    toast("已清空完成列表", "info");
  };

  return (
    <section className="page">
      <div className="page-head">
        <div className="tabs">
          {(["downloading", "completed"] as const).map((t) => (
            <button key={t} className={`tab${activeTab === t ? " active" : ""}`} onClick={() => setTab(t)}>
              {t === "downloading" ? "下载中" : "已完成"}
              <span className="count">{count(t)}</span>
            </button>
          ))}
        </div>
        <div className="btn-group">
          {downloading.some((t) => t.status === "downloading" || t.status === "queued" || t.status === "parsing" || t.status === "merging") && (
            <button type="button" className="btn sm ghost" onClick={pauseAll}>全部暂停</button>
          )}
          {downloading.some((t) => t.status === "paused" || t.status === "interrupted") && (
            <button type="button" className="btn sm ghost" onClick={resumeAll}>全部继续</button>
          )}
          {completed.length > 0 && (
            <button type="button" className="btn sm ghost" onClick={clearCompleted}>清空已完成</button>
          )}
          <button type="button" className="btn sm" onClick={() => void refresh()} disabled={loading}>
            {loading ? "刷新中…" : "刷新"}
          </button>
        </div>
      </div>

      {error && <div className="empty-state"><p className="muted">加载失败：{error}</p></div>}

      {tasks.length === 0 && !loading ? (
        <div className="empty-state">
          <Icon name="download" size={52} />
          <h3>暂无下载任务</h3>
          <p>到「解析」页解析链接并勾选条目，下载任务会显示在这里，实时更新进度。</p>
        </div>
      ) : (
        <div className="task-list">
          {(activeTab === "downloading" ? downloading : completed).map((t) => (
            <TaskCard key={t.id} task={t} onRemove={remove} />
          ))}
          {loading && <p className="muted small center">加载中…</p>}
        </div>
      )}
    </section>
  );
}

function TaskCard({ task, onRemove }: { task: TaskSummary; onRemove: (id: string) => void }) {
  const { toast } = useToast();
  const meta = TASK_STATUS_META[task.status];
  const pct = Math.min(100, Math.max(0, task.progress));
  const isDone = task.status === "completed";
  return (
    <div className={`task-card${isDone ? " done" : ""}`}>
      <div className="cover cover-0">
        <div className="cover-title">{task.title}</div>
      </div>
      <div className="task-main">
        <div className="task-title" title={task.title}>{task.title}</div>
        <div className="task-meta">
          <span>{task.groupTitle || "—"}</span>
          <span className="task-size">{fmtBytes(task.totalBytes)}</span>
          {task.qualityLabel && <span className="badge">{task.qualityLabel}</span>}
        </div>
        <div className="task-status-row">
          <span className={`status-chip ${meta.tone}`}>{meta.label}</span>
        </div>
        {task.error && <div className="task-error">{task.error}</div>}
      </div>
      <div className="task-right">
        <div className="progress-track"><div className="progress-bar" style={{ width: `${pct}%` }} /></div>
        <div className="task-status-row">
          <span className="status-chip muted">{isDone ? "已完成" : `${pct}%`}</span>
          <TaskActions task={task} onRemove={onRemove} onToast={toast} />
        </div>
      </div>
    </div>
  );
}

export function fmtBytes(b?: number): string {
  if (!b) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, n = b;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i > 1 ? 1 : 0)} ${u[i]}`;
}