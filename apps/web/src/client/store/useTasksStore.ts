import { create } from "zustand";
import type { TaskSummary } from "../services/types";
import { listTasks } from "../services/client";
import { TASK_STATUS_LABEL } from "../lib/taskText";

export type TaskTab = "downloading" | "completed";

/** 后端 TaskStatus → 前端主按钮动作（文案取自 lib/taskText 的 TASK_STATUS_LABEL，单一来源） */
export const TASK_STATUS_META: Record<TaskSummary["status"], { label: string; action: "pause" | "resume" | "retry" | "delete" | "open" | "none"; tone: string }> = {
  queued: { label: TASK_STATUS_LABEL.queued, action: "pause", tone: "queued" },
  parsing: { label: TASK_STATUS_LABEL.parsing, action: "pause", tone: "queued" },
  downloading: { label: TASK_STATUS_LABEL.downloading, action: "pause", tone: "downloading" },
  merging: { label: TASK_STATUS_LABEL.merging, action: "pause", tone: "merging" },
  paused: { label: TASK_STATUS_LABEL.paused, action: "resume", tone: "paused" },
  interrupted: { label: TASK_STATUS_LABEL.interrupted, action: "resume", tone: "paused" },
  failed: { label: TASK_STATUS_LABEL.failed, action: "retry", tone: "failed" },
  completed: { label: TASK_STATUS_LABEL.completed, action: "open", tone: "done" },
  cancelled: { label: TASK_STATUS_LABEL.cancelled, action: "delete", tone: "cancelled" },
};

/** 「下载中」的条数 = 未完成任务数（原版：下载列表的行数，用来喂导航栏徽章） */
export function activeTaskCount(tasks: TaskSummary[]): number {
  return tasks.filter(isDownloading).length;
}

interface TasksState {
  tasks: TaskSummary[];
  /** 导航栏「下载」徽章的数字（原版 update_download_btn_badge_info） */
  activeCount: number;
  activeTab: TaskTab;
  loading: boolean;
  error?: string;
  setTab: (t: TaskTab) => void;
  setTasks: (t: TaskSummary[]) => void;
  refresh: () => Promise<void>;
  /** 只刷徽章计数，不碰 loading —— 否则导航栏轮询会让下载页一直闪"加载中" */
  refreshBadge: () => Promise<void>;
  upsert: (t: TaskSummary) => void;
  remove: (id: string) => void;
}

export const useTasksStore = create<TasksState>((set) => ({
  tasks: [],
  activeCount: 0,
  activeTab: "downloading",
  loading: false,
  error: undefined,
  setTab: (t) => set({ activeTab: t }),
  setTasks: (tasks) => set({ tasks, activeCount: activeTaskCount(tasks) }),
  refresh: async () => {
    set({ loading: true, error: undefined });
    try {
      const { tasks } = await listTasks();
      set({ tasks, activeCount: activeTaskCount(tasks), loading: false });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), loading: false });
    }
  },
  refreshBadge: async () => {
    try {
      const { tasks } = await listTasks();
      set({ tasks, activeCount: activeTaskCount(tasks) });
    } catch {
      // 徽章是旁路信息，取不到就保持上一次的值，不打扰用户
    }
  },
  upsert: (t) => set((s) => {
    const tasks = [...s.tasks.filter((x) => x.id !== t.id), t];
    return { tasks, activeCount: activeTaskCount(tasks) };
  }),
  remove: (id) => set((s) => {
    const tasks = s.tasks.filter((t) => t.id !== id);
    return { tasks, activeCount: activeTaskCount(tasks) };
  }),
}));

/** 全部连接任务 SSE；若任务数少，直接轮询 refresh 更省。P2 采用"进入页面时 refresh + 每任务 SSE 订阅" */
export function isDownloading(t: TaskSummary): boolean {
  return t.status === "queued" || t.status === "parsing" || t.status === "downloading" || t.status === "merging" || t.status === "paused" || t.status === "interrupted" || t.status === "failed" || t.status === "cancelled";
}
export function isCompleted(t: TaskSummary): boolean {
  return t.status === "completed";
}