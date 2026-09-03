import { create } from "zustand";
import type { TaskSummary } from "../services/types";
import { listTasks } from "../services/client";

export type TaskTab = "downloading" | "completed";

/** 后端 TaskStatus → 前端主按钮动作 */
export const TASK_STATUS_META: Record<TaskSummary["status"], { label: string; action: "pause" | "resume" | "retry" | "delete" | "open" | "none"; tone: string }> = {
  queued: { label: "排队中", action: "pause", tone: "queued" },
  parsing: { label: "解析中", action: "pause", tone: "queued" },
  downloading: { label: "下载中", action: "pause", tone: "downloading" },
  merging: { label: "合并中", action: "pause", tone: "merging" },
  paused: { label: "已暂停", action: "resume", tone: "paused" },
  interrupted: { label: "已中断", action: "resume", tone: "paused" },
  failed: { label: "失败", action: "retry", tone: "failed" },
  completed: { label: "已完成", action: "open", tone: "done" },
  cancelled: { label: "已取消", action: "delete", tone: "cancelled" },
};

interface TasksState {
  tasks: TaskSummary[];
  activeTab: TaskTab;
  loading: boolean;
  error?: string;
  setTab: (t: TaskTab) => void;
  setTasks: (t: TaskSummary[]) => void;
  refresh: () => Promise<void>;
  upsert: (t: TaskSummary) => void;
  remove: (id: string) => void;
}

export const useTasksStore = create<TasksState>((set) => ({
  tasks: [],
  activeTab: "downloading",
  loading: false,
  error: undefined,
  setTab: (t) => set({ activeTab: t }),
  setTasks: (tasks) => set({ tasks }),
  refresh: async () => {
    set({ loading: true, error: undefined });
    try {
      const { tasks } = await listTasks();
      set({ tasks, loading: false });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), loading: false });
    }
  },
  upsert: (t) => set((s) => ({ tasks: [...s.tasks.filter((x) => x.id !== t.id), t] })),
  remove: (id) => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),
}));

/** 全部连接任务 SSE；若任务数少，直接轮询 refresh 更省。P2 采用"进入页面时 refresh + 每任务 SSE 订阅" */
export function isDownloading(t: TaskSummary): boolean {
  return t.status === "queued" || t.status === "parsing" || t.status === "downloading" || t.status === "merging" || t.status === "paused" || t.status === "interrupted" || t.status === "failed" || t.status === "cancelled";
}
export function isCompleted(t: TaskSummary): boolean {
  return t.status === "completed";
}