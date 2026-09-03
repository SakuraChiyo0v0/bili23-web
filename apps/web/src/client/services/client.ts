import type {
  DownloadOptions,
  MediaOptionSummary,
  ParseResult,
  TaskSummary,
} from "./types";

/** 后端 API 基础地址（Vite dev 默认 5173；生产由托管服务反代 /api） */
const BASE = import.meta.env.VITE_API_BASE ?? "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const text = await res.text();
  const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) {
    const err = (json.error ?? {}) as { code?: string; message?: string };
    throw new Error(err.message ?? `请求失败（${res.status}）`);
  }
  return json as T;
}

/** 解析一个链接（或 type 入口），返回条目列表 */
export function parseUrl(body: { urls?: string[] } | { type: string; query?: string; keyword?: string; pn?: number; pages?: number }): Promise<{ results: ParseResult[] }> {
  return request("/parse", { method: "POST", body: JSON.stringify(body) });
}

/** 单个条目的媒体候选（画质/音质/编码），P3 下载选项弹窗用 */
export function mediaOptions(itemId: string): Promise<MediaOptionSummary> {
  return request(`/media/${encodeURIComponent(itemId)}`);
}

/** 批量创建下载任务 */
export function createTasks(
  itemIds: string[],
  options?: DownloadOptions,
  force = false,
): Promise<{ tasks: TaskSummary[]; duplicates: Array<{ itemId: string; title: string }> }> {
  return request("/download", { method: "POST", body: JSON.stringify({ itemIds, options, force }) });
}

/** 全部任务列表 */
export function listTasks(): Promise<{ tasks: TaskSummary[] }> {
  return request("/tasks");
}

export function cancelTask(id: string): Promise<{ ok: boolean }> {
  return request(`/tasks/${encodeURIComponent(id)}/cancel`, { method: "POST" });
}
export function pauseTask(id: string): Promise<{ ok: boolean }> {
  return request(`/tasks/${encodeURIComponent(id)}/pause`, { method: "POST" });
}
export function resumeTask(id: string): Promise<{ ok: boolean }> {
  return request(`/tasks/${encodeURIComponent(id)}/resume`, { method: "POST" });
}
export function retryTask(id: string): Promise<{ ok: boolean }> {
  return request(`/tasks/${encodeURIComponent(id)}/retry`, { method: "POST" });
}
export function deleteTask(id: string): Promise<{ ok: boolean }> {
  return request(`/tasks/${encodeURIComponent(id)}/delete`, { method: "POST" });
}

/** 监听单任务 SSE 事件流 */
export function subscribeTaskEvents(id: string, onTask: (task: TaskSummary) => void): () => void {
  const es = new EventSource(BASE + `/tasks/${encodeURIComponent(id)}/events`);
  es.addEventListener("task", (ev) => {
    try {
      onTask(JSON.parse((ev as MessageEvent).data) as TaskSummary);
    } catch {
      // 忽略坏消息
    }
  });
  return () => es.close();
}

/** SSE 全部任务聚合：轮询 + 事件订阅（P2 下载页用，P1 暂不用） */
export function getConfig<T = any>(): Promise<{ config: T }> {
  return request("/config");
}
