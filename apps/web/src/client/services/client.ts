import type {
  DownloadOptions,
  AppConfig,
  AppConfigPatch,
  LogEntry,
  MediaItem,
  MediaOptionSummary,
  ParseResult,
  ProxyTestResult,
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
export function parseUrl(body:
  | { urls?: string[]; interactiveAll?: boolean }
  | { type: string; query?: string; keyword?: string; pn?: number; pages?: number; weekNum?: number; interactiveAll?: boolean },
): Promise<{ results: ParseResult[] }> {
  return request("/parse", { method: "POST", body: JSON.stringify(body) });
}

/** 命名规则预览（原版 EditRuleDialog.on_preview 的 dry-run，用示例数据渲染） */
export interface NamingPreviewResult {
  ok: boolean;
  /** 相对目录（原版 `result.parent`） */
  folder?: string;
  /** 文件名，不含扩展名（原版 `result.stem`） */
  fileName?: string;
  /** 校验失败提示（简中，逐字取原版） */
  message?: string;
}
export function previewNamingRule(rule: string, type?: number): Promise<NamingPreviewResult> {
  return request("/naming/preview", { method: "POST", body: JSON.stringify({ rule, type }) });
}

/** 单稿件分P 列表（原版 MultiPartListsDialog 的二次解析；不展开合集、不动主树） */export function listVideoParts(url: string): Promise<{ items: MediaItem[] }> {
  return request("/parts", { method: "POST", body: JSON.stringify({ url }) });
}

/** 单个条目的媒体候选（画质/音质/编码），P3 下载选项弹窗用 */export function mediaOptions(itemId: string): Promise<MediaOptionSummary> {
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
/**
 * 重新下载（原版任务行右键「重新下载」）：已完成/下载中也能重下。
 * 合并中被拒时后端返 409 `FFMPEG_BUSY`，这里**把错误原样抛出**，让调用方按 code 给提示
 * —— 不能让 UI 弹一句"已重新下载"却没发生任何事。
 */
export function redownloadTask(id: string): Promise<{ ok: boolean; task: TaskSummary }> {
  return request(`/tasks/${encodeURIComponent(id)}/redownload`, { method: "POST" });
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

export interface ParseHistoryItem { id: number; url: string; title: string; type: string; itemCount: number; createdAt: number }
export function listParseHistory(): Promise<{ history: ParseHistoryItem[] }> {
  return request("/parse-history");
}
export function deleteParseHistory(id: number): Promise<{ ok: boolean }> {
  return request(`/parse-history/${id}`, { method: "DELETE" });
}
export function taskLog(id: string): Promise<{ lines: string[] }> {
  return request(`/tasks/${encodeURIComponent(id)}/log`);
}
export function listFiles(): Promise<{ files: Array<{ name: string; path: string; size: number; mtime: number }> }> {
  return request("/files");
}

/** 目录选择器：列出指定绝对目录的子目录（下载目录浏览用） */
/**
 * 浏览服务端目录：返回子目录（带 `cover`，该目录里第一张图，用作列表封面）
 * 与当前目录里的图片文件（选择器显示成缩略图，便于"看图找目录"）。
 */
export function listDirs(path: string): Promise<{
  dirs: Array<{ name: string; path: string; cover?: string }>;
  images?: Array<{ name: string; path: string; size: number; thumb: boolean }>;
}> {
  return request("/dirs?path=" + encodeURIComponent(path));
}

/** 缩略图地址（服务端会校验是否在允许的存储范围内） */
export function fileThumbUrl(absPath: string): string {
  return `${BASE}/fs/thumb?path=${encodeURIComponent(absPath)}`;
}

/** 产物文件下载地址（用于"打开文件"） */
export function fileRawUrl(relPath: string): string {
  return `${BASE}/files/raw?path=${encodeURIComponent(relPath)}`;
}
export function updateConfig(patch: AppConfigPatch): Promise<{ config: AppConfig }> {
  return request("/config", { method: "PUT", body: JSON.stringify({ config: patch }) });
}
/** 代理连通性测试（原版「设置代理服务器」弹窗的「测试」按钮）：测的是表单当前值，不是已保存的配置 */
export function testProxy(form: { proxyType: string; proxyServer: string; proxyPort: number; proxyUname: string; proxyPassword: string }): Promise<ProxyTestResult> {
  return request("/proxy/test", { method: "POST", body: JSON.stringify(form) });
}
/** 应用日志（桌面「日志」窗口）：search 为包含匹配；返回最新的在前 */
export function listLogs(opts: { search?: string; limit?: number } = {}): Promise<{ entries: LogEntry[] }> {
  const q = new URLSearchParams();
  if (opts.search) q.set("search", opts.search);
  if (opts.limit) q.set("limit", String(opts.limit));
  const qs = q.toString();
  return request(`/logs${qs ? `?${qs}` : ""}`);
}
/** 清除日志（桌面「清除日志」） */
export function clearLogs(): Promise<{ ok: boolean }> {
  return request("/logs", { method: "DELETE" });
}
/** 导出配置（原版「配置文件设置 → 导出」）：拿回 JSON 对象，由调用方落成文件 */
export function exportConfig(): Promise<AppConfig> {
  return request("/config/export");
}
/** 导入配置（原版「配置文件设置 → 导入」）：净化 + 校验通过才落盘 */
export function importConfig(config: unknown): Promise<{ config: AppConfig }> {
  return request("/config/import", { method: "POST", body: JSON.stringify({ config }) });
}
/** 重置为默认配置（原版「配置文件设置 → 重置」） */
export function resetConfig(): Promise<{ config: AppConfig }> {
  return request("/config/reset", { method: "POST" });
}
/** MCP 运行状态（进程级；桌面把 mcp_running/mcp_last_error 放全局信号给设置卡显示） */
export function mcpStatus(): Promise<{ running: boolean; lastError: string }> {
  return request("/mcp/status");
}
export interface AuthStatus { loggedIn: boolean; preview: string; uname?: string; face?: string; mid?: number }
export interface QrLoginSession { qrUrl: string; qrcodeKey: string; status: number }
export function authStatus(): Promise<AuthStatus> { return request("/auth/status"); }
export function loginCookie(sessdata: string): Promise<AuthStatus> { return request("/auth", { method: "POST", body: JSON.stringify({ sessdata }) }); }
export function logoutAuth(): Promise<AuthStatus> { return request("/auth", { method: "DELETE" }); }
export function qrLoginStart(): Promise<QrLoginSession> { return request("/auth/qr", { method: "POST" }); }
export function qrLoginPoll(qrcodeKey: string): Promise<QrLoginSession & { loggedIn: boolean }> { return request("/auth/qr/poll", { method: "POST", body: JSON.stringify({ qrcodeKey }) }); }
export interface FavFolder { id: number; title: string; mediaCount: number; cover?: string; url: string }
export interface FollowBangumi { seasonId: number; title: string; cover: string; type: string; newEp: string; progress: string; desc: string; isFinish: number; url: string }
export interface Pagination { total: number; page: number; pageSize: number; totalPages: number }
/** 追番/追剧列表：type=1 追番 / 2 追剧；status=0 全部 / 1 想看 / 2 在看 / 3 看过（对齐原版浮层两个下拉） */
export function listFollowBangumi(type = "1", status = 0, pn = 1): Promise<{ follow: FollowBangumi[]; pagination: Pagination }> {
  const q = new URLSearchParams({ type, status: String(status), pn: String(pn) });
  return request("/bangumi/follow?" + q.toString());
}
/** 收藏夹列表：kind=created 我创建的 / collected 我订阅的（原版「收藏夹」与「订阅合集」两栏） */
export function listFavorites(kind: "created" | "collected" = "created"): Promise<{ mid: number; folders: FavFolder[] }> {
  return request("/favorites" + (kind === "collected" ? "?kind=collected" : ""));
}
/**
 * 「我创建的」收藏夹封面：那条列表接口不返回 cover，得逐个取（服务端限并发 3 + 缓存）。
 * 客户端是"列表先出来、封面随后填"，所以这是**另一个请求**。
 */
export function listFavFolderCovers(ids: number[]): Promise<{ covers: Record<string, string> }> {
  if (ids.length === 0) return Promise.resolve({ covers: {} });
  return request("/favorites/covers?ids=" + ids.join(","));
}
/**
 * 「选择目录」的辅助信息：这个目录**在哪台机器**上（见服务端 /api/system/info 注释）。
 * 刻意不含盘符/家目录 —— 那是用户个人电脑的信息，与应用无关。
 */
export function getSystemInfo(): Promise<{
  host: string;
  platform: string;
  /** 请求是不是从本机发的（服务跑在这台电脑上时界面要直说） */
  localhost: boolean;
  downloadDir: string;
  /** 允许的存储范围（空数组 = 未限制）；目录选择器只允许在这之内选 */
  allowedRoots: string[];
}> {
  return request("/system/info");
}