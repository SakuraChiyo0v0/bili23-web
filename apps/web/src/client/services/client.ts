import type {
  DownloadOptions,
  AppConfig,
  AppConfigPatch,
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
    const e = new Error(err.message ?? ("请求失败（" + res.status + "）")) as Error & { code?: string; status?: number; duplicates?: Array<{ itemId: string; title: string }> };
    e.code = err.code;
    e.status = res.status;
    if (Array.isArray((json as any).duplicates)) e.duplicates = (json as any).duplicates;
    throw e;
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
export function getConfig(): Promise<{ config: AppConfig }> {
  return request("/config");
}

export function listHistory(): Promise<{ history: Array<{ taskId: string; title: string; completedAt: number; outputPath?: string; error?: string }> }> {
  return request("/history");
}
export function deleteHistory(taskId: string): Promise<{ ok: boolean }> {
  return request(`/history/${encodeURIComponent(taskId)}`, { method: "DELETE" });
}
export function taskLog(id: string): Promise<{ lines: string[] }> {
  return request(`/tasks/${encodeURIComponent(id)}/log`);
}
export function listFiles(): Promise<{ files: Array<{ name: string; path: string; size: number; mtime: number }> }> {
  return request("/files");
}
/** 产物文件下载地址（用于"打开文件"） */
export function fileRawUrl(relPath: string): string {
  return `${BASE}/files/raw?path=${encodeURIComponent(relPath)}`;
}
export function updateConfig(patch: AppConfigPatch): Promise<{ config: AppConfig }> {
  return request("/config", { method: "PUT", body: JSON.stringify({ config: patch }) });
}
export interface AuthStatus { loggedIn: boolean; preview: string }
export interface QrLoginSession { qrUrl: string; qrcodeKey: string; status: number }
export function authStatus(): Promise<AuthStatus> { return request("/auth/status"); }
export function loginCookie(sessdata: string): Promise<AuthStatus> { return request("/auth", { method: "POST", body: JSON.stringify({ sessdata }) }); }
export function logoutAuth(): Promise<AuthStatus> { return request("/auth", { method: "DELETE" }); }
export function qrLoginStart(): Promise<QrLoginSession> { return request("/auth/qr", { method: "POST" }); }
export function qrLoginPoll(qrcodeKey: string): Promise<QrLoginSession & { loggedIn: boolean }> { return request("/auth/qr/poll", { method: "POST", body: JSON.stringify({ qrcodeKey }) }); }