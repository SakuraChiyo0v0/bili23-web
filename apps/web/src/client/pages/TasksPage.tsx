import { useEffect, useMemo, useRef, useState } from "react";
import { subscribeTaskEvents, pauseTask, resumeTask, redownloadTask, deleteTask, parseUrl } from "../services/client";
import {
  useTasksStore, isDownloading, isCompleted, TASK_STATUS_META, type TaskTab,
} from "../store/useTasksStore";
import { Icon } from "../lib/icons";
import { useToast } from "../lib/toast";
import { useDownloadListPrefs, COMPLETED_SORTS, DOWNLOADING_SORTS, type SortField } from "../lib/downloadListPrefs";
import { fmtBytes, taskInfoText, taskSizeText, taskStatusText } from "../lib/taskText";
import { useParseSession } from "../store/useParseSession";
import type { TaskSummary } from "../services/types";
import { TaskActions } from "../components/TaskActions";
import { t as tr } from "../lib/i18n";

export function TasksPage() {
  const { tasks, activeTab, loading, error, setTab, refresh, upsert, remove } = useTasksStore();
  const { toast } = useToast();
  const [sortPrefs, setSortPrefs] = useDownloadListPrefs();

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

  // 任务完成/失败通知：首次进入只建立基线；之后新进入终态的任务弹提示与浏览器通知
  const notifiedRef = useRef<Set<string>>(new Set());
  const baselineRef = useRef(false);
  useEffect(() => {
    const terminal: Record<string, TaskSummary> = {};
    for (const t of tasks) {
      if (t.status === "completed" || t.status === "failed" || t.status === "cancelled") terminal[t.id] = t;
    }
    if (!baselineRef.current) {
      baselineRef.current = true;
      for (const id of Object.keys(terminal)) notifiedRef.current.add(id);
      return;
    }
    for (const t of Object.values(terminal)) {
      if (notifiedRef.current.has(t.id)) continue;
      notifiedRef.current.add(t.id);
      const ok = t.status === "completed";
      toast(ok ? `下载完成：${t.title}` : `下载失败：${t.title}`, ok ? "ok" : "err");
      if (sortPrefs.notifyFinished && typeof Notification !== "undefined" && Notification.permission === "granted") {
        try {
          new Notification(ok ? tr("下载完成") : tr("下载失败"), { body: t.title, tag: t.id });
        } catch { /* 忽略通知异常 */ }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks.map((t) => `${t.id}:${t.status}`).join("|")]);

  // 下载中/已完成 双页签列表
  const downloading = useMemo(() => tasks.filter(isDownloading), [tasks]);
  const completed = useMemo(() => tasks.filter(isCompleted), [tasks]);

  const count = (t: TaskTab) => (t === "downloading" ? downloading.length : completed.length);
  /** 当前页签的列表（空态与渲染都以它为准） */
  const currentList = activeTab === "downloading" ? downloading : completed;

  // 下载队列排序（原版两个页签各存一套偏好，见 download.py:38-48）
  const tabPref = activeTab === "downloading" ? sortPrefs.downloading : sortPrefs.completed;
  const sortOptions = activeTab === "downloading" ? DOWNLOADING_SORTS : COMPLETED_SORTS;
  const sortTasks = useMemo(() => {
    const val = (t: TaskSummary): number | string => {
      switch (tabPref.sort) {
        case "title": return t.title.toLowerCase();
        case "size": return t.totalBytes;
        case "progress": return t.progress;
        case "completed": return t.updatedAt;
        default: return t.createdAt;
      }
    };
    const dir = tabPref.desc ? -1 : 1;
    return (list: TaskSummary[]) => [...list].sort((a, b) => {
      const va = val(a); const vb = val(b);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return (a.createdAt - b.createdAt) * dir;
    });
  }, [tabPref]);
  const sortSel = <select className="text-input" style={{ height: 30, width: 132 }} value={tabPref.sort}
    onChange={(e) => setSortPrefs({ [activeTab]: { ...tabPref, sort: e.target.value as SortField } })} aria-label={tr("排序字段")}>
    {sortOptions.map(([k, label]) => <option key={k} value={k}>按{label}</option>)}
  </select>;
  const dirBtn = <button type="button" className="btn sm ghost" onClick={() => setSortPrefs({ [activeTab]: { ...tabPref, desc: !tabPref.desc } })} title={tabPref.desc ? tr("降序") : tr("升序")}>{tabPref.desc ? "↓" : "↑"}</button>;

  /** 「全部开始」——原版把 PAUSED / FAILED / 已中断 的任务统一置为排队再调度 */
  const startAll = async () => {
    const targets = downloading.filter((t) => ["paused", "interrupted", "failed"].includes(t.status));
    await Promise.all(targets.map((t) => resumeTask(t.id).catch(() => null)));
    await refresh();
    toast(`已开始 ${targets.length} 个任务`, "ok");
  };
  const pauseAll = async () => {
    const targets = downloading.filter((t) => ["downloading", "queued", "parsing", "merging"].includes(t.status));
    await Promise.all(targets.map((t) => pauseTask(t.id).catch(() => null)));
    await refresh();
    toast(`已暂停 ${targets.length} 个任务`, "ok");
  };
  /** 「全部删除」= 把当前页签的条目全删掉（原版 Delete All） */
  const deleteAll = async () => {
    await Promise.all(downloading.map((t) => deleteTask(t.id).catch(() => null)));
    await refresh();
    toast(`已删除 ${downloading.length} 个任务`, "info");
  };
  const clearCompleted = async () => {
    await Promise.all(completed.map((t) => deleteTask(t.id).catch(() => null)));
    await refresh();
    toast(tr("已清除记录"), "info");
  };

  return (
    <section className="page">
      <div className="page-head">
        <div className="tabs">
          {(["downloading", "completed"] as const).map((t) => (
            <button key={t} className={`tab${activeTab === t ? " active" : ""}`} onClick={() => setTab(t)}>
              {t === "downloading" ? tr("正在下载") : tr("下载完成")}
              <span className="count">{count(t)}</span>
            </button>
          ))}
        </div>
        <div className="sort-ctl">{sortSel}{dirBtn}</div>
        {/* 按钮组对齐原版（top_widget.py:144-193）：下载中 = 全部开始 / 全部暂停 / 全部删除；已完成 = 清除记录 */}
        <div className="btn-group">
          {/* 原版工具栏第二个按钮是「打开下载目录」（调系统文件管理器）。
              浏览器没有等价物 —— 落点是产物浏览页（设计稿 §四），所以这里跳那一页。 */}
          <button type="button" className="btn sm ghost" onClick={() => { window.location.hash = "#/files"; }} title={tr("打开下载目录")}>
            <Icon name="folder" size={15} />打开下载目录
          </button>
          {activeTab === "downloading" ? (
            <>
              <button type="button" className="btn sm" onClick={startAll}
                disabled={!downloading.some((t) => ["paused", "interrupted", "failed"].includes(t.status))}>{tr("全部开始")}</button>
              <button type="button" className="btn sm ghost" onClick={pauseAll}
                disabled={!downloading.some((t) => ["downloading", "queued", "parsing", "merging"].includes(t.status))}>{tr("全部暂停")}</button>
              <button type="button" className="btn sm ghost dangerous" onClick={deleteAll} disabled={downloading.length === 0}>{tr("全部删除")}</button>
            </>
          ) : (
            <button type="button" className="btn sm ghost" onClick={clearCompleted} disabled={completed.length === 0}>{tr("清除记录")}</button>
          )}
          <button type="button" className="btn sm ghost" onClick={() => void refresh()} disabled={loading}>
            {loading ? tr("刷新中…") : tr("刷新")}
          </button>
        </div>
      </div>

      {error && <div className="empty-state"><p className="muted">加载失败：{error}</p></div>}

      {/* 空态按**当前页签**判断：原版两个页签各有自己的空态文案（download.py:34,44）。
          之前用的是"全部任务数为 0"，于是"下载中"为空而"已完成"有内容时，
          这个页签会是一片空白 —— 实测截图才发现。 */}
      {currentList.length === 0 && !loading ? (
        <div className="empty-state">
          <Icon name="download" size={52} />
          {/* 原版空态文案（download.py:34,44） */}
          <h3>{activeTab === "downloading" ? tr("没有正在下载的任务") : tr("没有下载完成的任务")}</h3>
          <p>{tr("到「解析」页解析链接并勾选条目，下载任务会显示在这里，实时更新进度。")}</p>
        </div>
      ) : (
        <div className="task-list">
          {sortTasks(currentList).map((t) => (
            <TaskCard key={t.id} task={t} onRemove={remove} />
          ))}
          {loading && <p className="muted small center">{tr("加载中…")}</p>}
        </div>
      )}
    </section>
  );
}

function TaskCard({ task, onRemove, index = 0 }: { task: TaskSummary; onRemove: (id: string) => void; /** 列表位置，用来做入场交错（超过 12 不再累加） */ index?: number }) {
  const { toast, toastLong } = useToast();
  const parseSession = useParseSession();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const meta = TASK_STATUS_META[task.status];
  const pct = Math.min(100, Math.max(0, task.progress));
  const isDone = task.status === "completed";

  /**
   * 字段规则全部照原版 `download_list/item_delegate.py` 的 UIData —— 抽在
   * `lib/taskText.ts` 里（纯函数、有单测），这里只管摆位。
   */
  const sizeText = taskSizeText(task);
  const statusText = taskStatusText(task);
  const infoText = taskInfoText(task);

  const run = async (fn: () => Promise<unknown>, msg: string) => {
    try { await fn(); toast(msg, "ok"); await useTasksStore.getState().refresh(); }
    catch (e) { toastLong(tr("操作失败"), e instanceof Error ? e.message : String(e), "err"); }
  };

  /**
   * 「重新下载」—— 原版 `list_view.py:181-191`：合并中直接警告并返回，
   * 否则提示「选定的任务开始重新下载」再执行。**不能**像以前那样无脑 toast「已重新下载」：
   * 老实现调的是 `retryTask`，对已完成/下载中的任务服务端会拒绝，UI 却报成功（"看起来像成功"）。
   */
  const redownload = async () => {
    try {
      await redownloadTask(task.id);
      toast(tr("选定的任务开始重新下载"), "ok");
      await useTasksStore.getState().refresh();
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === "FFMPEG_BUSY") { toast(tr("处于 FFmpeg 处理中的任务无法重新下载"), "warn"); return; }
      toast(err.message || "重新下载失败", "err");
    }
  };

  /** 「重新解析」：原版 `onReparseTask` 是拿任务的 url 重新走一次解析，并切回解析页 */
  const reparse = async () => {
    if (!task.url) { toast(tr("这条任务没有可重新解析的链接"), "warn"); return; }
    try {
      const r = await parseUrl({ urls: [task.url] });
      if (!r.results.length) throw new Error("解析结果为空");
      parseSession.setParseType("auto");
      parseSession.setInput(task.url);
      parseSession.success(r.results);
      window.location.hash = "#/parse";
      toast(tr("已重新解析"), "ok");
    } catch (e) {
      toast("解析失败：" + (e instanceof Error ? e.message : String(e)), "err");
    }
  };

  const act = (fn: () => void) => { fn(); setMenu(null); };

  return (
    <div className={`task-card${isDone ? " done" : ""}`}
      style={{ ["--i"]: Math.min(index, 12) } as React.CSSProperties}
      onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}>
      {task.cover ? (
        <img className="cover cover-img" src={task.cover} alt="" loading="lazy" referrerPolicy="no-referrer" onLoad={(e) => e.currentTarget.classList.add("loaded")} onError={(e)=>{ (e.currentTarget as HTMLImageElement).style.display="none"; }} />
      ) : (
        <div className="cover cover-0">
          <div className="cover-title">{task.title}</div>
        </div>
      )}
      <div className="task-main">
        <div className="task-title" title={task.title}>{task.title}</div>
        <div className="task-meta">
          <span className="task-info" title={infoText}>{infoText || "—"}</span>
          <span className={`task-size${isDone ? " muted" : ""}`}>{sizeText}</span>
          {task.qualityLabel && <span className="badge">{task.qualityLabel}</span>}
        </div>
        {task.error && <div className="task-error">{task.error}</div>}
      </div>
      <div className="task-right">
        <div className="progress-track"><div className="progress-bar" style={{ width: `${pct}%` }} /></div>
        <div className="task-status-row">
          <span className={`status-chip ${meta.tone}`}>{statusText}</span>
          <TaskActions task={task} onRemove={onRemove} onToast={toast} />
        </div>
      </div>

      {/* 任务行右键菜单 —— 项与条件照搬原版 `download_list/list_view.py:51-72`：
          完成 → 重新解析；排队/暂停 → 继续；下载中 → 暂停；恒有 → 重新下载；分隔线；删除 */}
      {menu && (
        <div className="ctx-layer" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }}>
          <div className="ctx-menu" style={{ left: Math.min(menu.x, window.innerWidth - 190), top: Math.min(menu.y, window.innerHeight - 220) }}
            onClick={(e) => e.stopPropagation()}>
            {task.status === "completed" && (
              <button type="button" className="ctx-item" onClick={() => act(() => void reparse())}>{tr("重新解析")}</button>
            )}
            {(task.status === "queued" || task.status === "paused" || task.status === "interrupted") && (
              <button type="button" className="ctx-item" onClick={() => act(() => void run(() => resumeTask(task.id), "已继续"))}>{tr("继续")}</button>
            )}
            {(task.status === "downloading" || task.status === "parsing" || task.status === "merging") && (
              <button type="button" className="ctx-item" onClick={() => act(() => void run(() => pauseTask(task.id), "已暂停"))}>{tr("暂停")}</button>
            )}
            <button type="button" className="ctx-item" onClick={() => act(() => void redownload())}>{tr("重新下载")}</button>
            <div className="ctx-sep" />
            <button type="button" className="ctx-item" onClick={() => act(() => void run(async () => { await deleteTask(task.id); onRemove(task.id); }, "已删除"))}>{tr("删除")}</button>
          </div>
        </div>
      )}
    </div>
  );
}

export { fmtBytes };

/** 下载速率/字节格式化/任务卡文本规则都在 lib/taskText.ts（纯函数、有单测） */
