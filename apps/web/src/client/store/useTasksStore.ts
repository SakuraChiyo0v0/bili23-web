import { create } from "zustand";
import type { TaskSummary } from "../services/types";
import { listTasks } from "../services/client";
import { TASK_STATUS_LABEL } from "../lib/taskText";
import { mergeTasks, upsertTask } from "../lib/taskOrder";

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
  /** 批量加入新任务（按 id 合并：已有的保持原位，新的追加到末尾）—— 创建任务后调用 */
  addTasks: (list: TaskSummary[]) => void;
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
  /**
   * 更新单个任务（进度/状态变化时调用）。
   *
   * ⚠️ **必须原地替换，不能"删掉再追加到末尾"** ——
   * 原来写的是 `[...s.tasks.filter(x => x.id !== t.id), t]`，于是每次进度更新都把该任务
   * 挪到列表**末尾**；批量下载时正在下的那几个任务每秒更新好几次，
   * 列表顺序就会疯狂跳动（用户实测：「下了 20 多话，1 到 20 一直在轮流转，一直在闪」）。
   * 而且同一秒创建的任务 `createdAt` 相同、排序对它**等于没排**，顺序完全由数组决定 ——
   * 所以这个位置必须稳住。
   */
  upsert: (t) => set((s) => {
    const tasks = upsertTask(s.tasks, t);   // 原地替换，绝不改变位置（见 lib/taskOrder.ts）
    return { tasks, activeCount: activeTaskCount(tasks) };
  }),
  /**
   * 批量加入新任务。**不要用 `setTasks(新建的那批)`** —— 那是整表替换：
   * store 里会瞬间只剩这批新任务、已完成的被挤掉，下一次刷新又回来，列表就会跳一下
   * （批量建 20 个任务时尤其明显）。
   */
  addTasks: (list) => set((s) => {
    const tasks = mergeTasks(s.tasks, list);
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