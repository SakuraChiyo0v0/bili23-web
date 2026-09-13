import { Hono } from "hono";
import { stream, streamSSE } from "hono/streaming";
import { createReadStream } from "node:fs";
import { basename } from "node:path";
import { stat } from "node:fs/promises";
import { hostname } from "node:os";
import { BiliError } from "@bili23-web/engine";
import { previewNamingRule } from "./naming-preview.js";
import type { ParseResult, ParseHistoryEntry, MediaItem } from "@bili23-web/engine";
import type {
  AppConfig,
  AppConfigPatch,
} from "./config.js";
import type {
  DownloadOptions,
  DirEntry,
  FileEntry,
  HistoryEntryDto,
  LogEntry,
  MediaOptionSummary,
  ProxyTestResult,
  TaskStatus,
  TaskSummary,
  ParseRequest,
  AuthStatus,
  QrLoginSession,
} from "./download-manager.js";

/**
 * REST + SSE 路由。
 * - POST /api/parse          {urls}           → 解析结果（含条目）
 * - GET  /api/media/:itemId                   → 可选画质/编码/音质
 * - POST /api/download       {itemIds,options,force} → 创建任务（重复项返回提示）
 * - GET  /api/tasks                          → 全部任务
 * - GET  /api/tasks/:id/events               → SSE 进度
 * - POST /api/tasks/:id/cancel               → 取消
 * - POST /api/tasks/:id/pause                → 暂停（保留断点）
 * - POST /api/tasks/:id/resume               → 继续（断点续传）
 * - POST /api/tasks/:id/retry                → 重试（清空断点）
 * - POST /api/tasks/:id/redownload           → 重新下载（已完成/下载中可重下；合并中拒绝）
 * - POST /api/tasks/:id/delete               → 删除任务（含历史行与 .tmp）
 * - GET  /api/tasks/:id/log                  → 任务生命周期日志
 * - GET  /api/history                        → 已完成历史（completed_task）
 * - DELETE /api/history/:taskId              → 删除单条历史记录
 * - GET  /api/files                          → 产物目录
 * - GET  /api/files/raw?path=...             → 产物文件下载（防目录穿越）
 */

/** 代理连通性测试结果（定义在 download-manager，那里是下游；客户端 `services/types.ts` 有同名镜像） */
export type { ProxyTestResult };

export interface ApiDeps {
  parseUrls(urls: string[], opts?: { expandInteractive?: boolean }): Promise<ParseResult[]>;
  /** 单稿件分P 列表（原版 MultiPartListsDialog 的二次解析，不展开合集） */
  listVideoParts?(url: string): Promise<MediaItem[]>;
  mediaOptions(itemId: string): Promise<MediaOptionSummary>;
  createTasks(
    itemIds: string[],
    options: DownloadOptions,
    force?: boolean,
  ): Promise<{ tasks: TaskSummary[]; duplicates: Array<{ itemId: string; title: string }> }>;
  listTasks(): TaskSummary[];
  getTask(id: string): TaskSummary | undefined;
  subscribeTask(id: string, listener: (summary: TaskSummary) => void): (() => void) | undefined;
  cancelTask(id: string): void;
  pauseTask(id: string): TaskSummary | undefined;
  resumeTask(id: string): TaskSummary | undefined;
  retryTask(id: string): TaskSummary | undefined;
  /** 重新下载（已完成/下载中也能重下；合并中返回 ffmpeg 拒绝） */
  redownloadTask?(id: string): Promise<{ ok: true; task: TaskSummary } | { ok: false; reason: "notfound" | "ffmpeg" }>;
  deleteTask(id: string): Promise<boolean>;
  listHistory(): HistoryEntryDto[];
  deleteHistory(taskId: string): boolean;
  taskLog(id: string): string[] | undefined;
  resolveDownloadFile(relPath: string): string | undefined;
  listFiles(): Promise<FileEntry[]>;
  listSubdirs?(absDir: string): Promise<DirEntry[]>;
  /** 服务器自己的目录信息（目录选择器里要显示"这是哪台机器上的目录"） */
  fsRoots?(): { dataDir: string; downloadDir: string };
  /** 应用日志（桌面「日志」窗口）：读最新在前可搜索 / 清空 */
  readLogs?(opts: { search?: string; limit?: number }): LogEntry[];
  clearLogs?(): void;
  getConfig?(): Promise<AppConfig>;
  /** 配置导入/导出/重置（原版「配置文件设置」卡） */
  exportConfig?(): Promise<AppConfig>;
  importConfig?(raw: unknown): Promise<AppConfig>;
  resetConfig?(): Promise<AppConfig>;
  updateConfig?(patch: AppConfigPatch): Promise<AppConfig>;
  /**
   * 代理连通性测试（原版「设置代理服务器」弹窗的「测试」按钮）：   * 用给定代理去问 B 站自己的 `x/web-interface/zone`，返回出口 IP/地区/ISP。
   */
  testProxy?(form: { proxyType: string; proxyServer: string; proxyPort: number; proxyUname: string; proxyPassword: string }): Promise<ProxyTestResult>;
  /** 类型化解析请求（type 入口） */
  parseRequest?(req: ParseRequest): Promise<ParseResult[]>;
  /** 解析历史 */
  listParseHistory?(): ParseHistoryEntry[];
  deleteParseHistory?(id: number): boolean;
  loginAuth?(sessdata: string): Promise<AuthStatus>;
  qrLoginStart?(): Promise<QrLoginSession>;
  qrLoginPoll?(qrcodeKey: string): Promise<QrLoginSession & { loggedIn: boolean }>;
  logoutAuth?(): Promise<AuthStatus>;
  authStatus?(): Promise<AuthStatus>;
  /** 收藏夹列表：kind=created 我创建的 / collected 我订阅的（原版「收藏夹」与「订阅合集」） */
  listFavFolders?(kind?: "created" | "collected"): Promise<{ mid: number; folders: Array<{ id: number; title: string; mediaCount: number; cover: string; url: string }> }>;
  /** 逐个取「我创建的」收藏夹封面（限并发 + 缓存；见实现注释里 412 的坑） */
  listFavFolderCovers?(ids: number[]): Promise<Record<number, string>>;
  /** 「保存到本机」：按任务 id 解析投递产物（三重校验，见实现） */
  deliverFilePath?(taskId: string): string | undefined;
  /** 投递完成后删除服务器副本 */
  removeDelivered?(taskId: string, abs: string): Promise<void>;
  /** 追番/追剧：type=1 追番 / 2 追剧；status=0 全部 / 1 想看 / 2 在看 / 3 看过；pn 分页 */
  listFollowBangumi?(type?: string, status?: number, pn?: number): Promise<{
    follow: Array<{ seasonId: number; title: string; cover: string; type: string; newEp: string; progress: string; desc: string; isFinish: number; url: string }>;
    pagination: { total: number; page: number; pageSize: number; totalPages: number };
  }>;
}

export type ApiErrorStatus = 400 | 401 | 404 | 409 | 500 | 502;

export function errorBody(err: unknown): { status: ApiErrorStatus; body: { error: { code: string; message: string } } } {
  if (err instanceof BiliError) {
    const status: ApiErrorStatus =
      err.code === "LOGIN_REQUIRED"
        ? 401
        : err.code === "UNSUPPORTED_TYPE" || err.code === "INVALID_URL"
          ? 400
          : err.code === "DOWNLOAD_FAILED" || err.code === "MERGE_FAILED"
            ? 502
            : 500;
    return { status, body: { error: { code: err.code, message: err.message } } };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { status: 500, body: { error: { code: "UNKNOWN", message } } };
}

/** 可暂停状态（queued 或运行中） */
const PAUSABLE_STATUSES = new Set<TaskStatus>(["queued", "parsing", "downloading", "merging"]);
/** 可继续状态（暂停/中断/失败/已取消 → 断点续传） */
const RESUMABLE_STATUSES = new Set<TaskStatus>(["paused", "interrupted", "failed", "cancelled"]);
/** 可重试状态（失败/已取消 → 清空断点全新下载） */
const RETRYABLE_STATUSES = new Set<TaskStatus>(["failed", "cancelled"]);

export function registerApi(app: Hono, getManager: () => ApiDeps, extra?: {
  /** MCP 运行状态（进程级，不在配置里） */
  mcpStatus?: () => { running: boolean; lastError: string };
}): void {
  app.post("/api/parse", async (c) => {
    try {
      const body = (await c.req.json()) as ParseRequest;
      // 类型入口（space/favlist/watch_later/history/popular 等）：由服务端构造 URL
      const manager = getManager();
      if (body.type && manager.parseRequest) {
        const results = await manager.parseRequest(body);
        return c.json({ results });
      }
      const urls = (body.urls ?? []).filter((u) => typeof u === "string" && u.trim().length > 0);
      if (urls.length === 0) {
        return c.json({ error: { code: "INVALID_URL", message: "请至少输入一个链接" } }, 400);
      }
      const results = await getManager().parseUrls(urls, { expandInteractive: body.interactiveAll === true });
      return c.json({ results });
    } catch (err) {
      const { status, body } = errorBody(err);
      return c.json(body, status);
    }
  });

  /**
   * 单稿件的分P 列表 —— 原版 `MultiPartListsDialog` 的二次解析。
   * 只取这个稿件自己的分P，不展开合集，也不改动主解析树。
   */
  app.post("/api/parts", async (c) => {
    try {
      const body = (await c.req.json()) as { url?: string };
      const url = (body.url ?? "").trim();
      if (!url) {
        return c.json({ error: { code: "INVALID_URL", message: "缺少稿件链接" } }, 400);
      }
      const manager = getManager();
      if (!manager.listVideoParts) {
        return c.json({ error: { code: "UNSUPPORTED", message: "当前实现不支持分P 列表" } }, 400);
      }
      const items = await manager.listVideoParts(url);
      return c.json({ items });
    } catch (err) {
      const { status, body } = errorBody(err);
      return c.json(body, status);
    }
  });

  /**
   * 命名规则预览（原版 `EditRuleDialog.on_preview` 的 dry-run）。
   * 纯函数、不碰网络，用固定示例数据渲染；设置页没有解析上下文，所以标注为示例。
   */
  app.post("/api/naming/preview", async (c) => {
    try {
      const body = (await c.req.json()) as { rule?: string; type?: number };
      const rule = typeof body.rule === "string" ? body.rule : "";
      const type = typeof body.type === "number" ? (body.type as 11) : 11;
      return c.json(previewNamingRule(rule, type));
    } catch (err) {
      const { status, body } = errorBody(err);
      return c.json(body, status);
    }
  });

  app.get("/api/media/:itemId", async (c) => {
    try {
      const summary = await getManager().mediaOptions(c.req.param("itemId"));
      return c.json(summary);
    } catch (err) {
      const { status, body } = errorBody(err);
      return c.json(body, status);
    }
  });

  app.post("/api/download", async (c) => {
    try {
      const body = (await c.req.json()) as {
        itemIds?: string[];
        options?: DownloadOptions;
        force?: boolean;
      };
      const itemIds = body.itemIds ?? [];
      if (itemIds.length === 0) {
        return c.json({ error: { code: "INVALID_URL", message: "未选择要下载的条目" } }, 400);
      }
      const options = body.options ?? {};
      const out = await getManager().createTasks(itemIds, options, body.force === true);
      if (out.duplicates.length > 0 && out.tasks.length === 0) {
        return c.json({ error: { code: "DUPLICATE", message: "以下内容已下载过", duplicates: out.duplicates } }, 409);
      }
      return c.json(out);
    } catch (err) {
      const { status, body } = errorBody(err);
      return c.json(body, status);
    }
  });

  app.get("/api/tasks", (c) => c.json({ tasks: getManager().listTasks() }));

  app.get("/api/tasks/:id", (c) => {
    const task = getManager().getTask(c.req.param("id"));
    if (!task) return c.json({ error: { code: "NOT_FOUND", message: "任务不存在" } }, 404);
    return c.json(task);
  });

  app.get("/api/tasks/:id/events", (c) => {
    const id = c.req.param("id");
    const manager = getManager();
    return streamSSE(c, async (stream) => {
      const unsubscribe = manager.subscribeTask(id, (summary: TaskSummary) => {
        void stream.writeSSE({ event: "task", data: JSON.stringify(summary) });
      });
      stream.onAbort(() => unsubscribe?.());
      while (!stream.aborted) {
        await stream.sleep(15_000);
        if (stream.aborted) break;
        await stream.writeSSE({ event: "ping", data: "" });
      }
    });
  });

  app.post("/api/tasks/:id/cancel", (c) => {
    const manager = getManager();
    const task = manager.getTask(c.req.param("id"));
    if (!task) return c.json({ error: { code: "NOT_FOUND", message: "任务不存在" } }, 404);
    manager.cancelTask(task.id);
    return c.json({ ok: true });
  });

  app.get("/api/files", async (c) => c.json({ files: await getManager().listFiles() }));

  /** 应用日志（桌面「日志」窗口）：search 为包含匹配，limit 默认 1000，返回最新的在前 */
  app.get("/api/logs", async (c) => {
    const manager = getManager();
    if (!manager.readLogs) return c.json({ entries: [] });
    const search = c.req.query("search") ?? "";
    const limit = Number(c.req.query("limit") ?? 1000) || 1000;
    return c.json({ entries: manager.readLogs({ search, limit }) });
  });

  /** 清除日志（桌面「清除日志」） */
  app.delete("/api/logs", async (c) => {
    const manager = getManager();
    manager.clearLogs?.();
    return c.json({ ok: true });
  });
  /** 目录选择器：列出指定绝对目录的子目录（下载目录浏览用；路径越界/不存在返回空列表） */
  /**
   * 「选择目录」的辅助信息：**这个目录在哪台机器上**。
   *
   * 起因：用户选「NAS 模式」却看到 `C:\...`，以为是我们搞错了 —— 其实「浏览…」列的一直是
   * **运行服务的那台机器**的文件系统；服务跑在他自己电脑上，所以看起来像"本机目录"。
   *
   * ⚠️ 刻意**只**返回 主机名 / 是否本机 / 下载目录：
   * 不要枚举用户的盘符或家目录 —— 那是他个人电脑的信息，跟这个应用没关系。
   * 这个应用只关心"服务端能访问到的那个目录"。
   */
  app.get("/api/system/info", (c) => {
    const manager = getManager();
    const hostHeader = c.req.header("host") ?? "";
    const localhost = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(hostHeader);
    const info = manager.fsRoots?.() ?? { dataDir: "", downloadDir: "" };
    return c.json({ host: hostname(), platform: process.platform, localhost, downloadDir: info.downloadDir });
  });
  app.get("/api/dirs", async (c) => {
    const manager = getManager();
    const dir = c.req.query("path") ?? "";
    if (!dir || dir.length === 0) return c.json({ dirs: [] });
    let st;
    try {
      st = await stat(dir);
    } catch {
      return c.json({ dirs: [] });
    }
    if (!st.isDirectory() || !manager.listSubdirs) return c.json({ dirs: [] });
    const dirs: DirEntry[] = await manager.listSubdirs(dir);
    return c.json({ dirs });
  });

  app.post("/api/tasks/:id/pause", (c) => {
    const manager = getManager();
    const id = c.req.param("id");
    const task = manager.getTask(id);
    if (!task) return c.json({ error: { code: "NOT_FOUND", message: "任务不存在" } }, 404);
    if (!PAUSABLE_STATUSES.has(task.status)) {
      return c.json({ error: { code: "INVALID_STATE", message: "任务当前状态不可暂停" } }, 409);
    }
    manager.pauseTask(id);
    return c.json({ ok: true });
  });

  app.post("/api/tasks/:id/resume", (c) => {
    const manager = getManager();
    const id = c.req.param("id");
    const task = manager.getTask(id);
    if (!task) return c.json({ error: { code: "NOT_FOUND", message: "任务不存在" } }, 404);
    if (!RESUMABLE_STATUSES.has(task.status)) {
      return c.json({ error: { code: "INVALID_STATE", message: "任务当前状态不可继续" } }, 409);
    }
    manager.resumeTask(id);
    return c.json({ ok: true });
  });

  app.post("/api/tasks/:id/retry", (c) => {
    const manager = getManager();
    const id = c.req.param("id");
    const task = manager.getTask(id);
    if (!task) return c.json({ error: { code: "NOT_FOUND", message: "任务不存在" } }, 404);
    if (!RETRYABLE_STATUSES.has(task.status)) {
      return c.json({ error: { code: "INVALID_STATE", message: "任务当前状态不可重试" } }, 409);
    }
    manager.retryTask(id);
    return c.json({ ok: true });
  });

  /**
   * 重新下载（原版任务行右键「重新下载」，`list_view.py:181-191`）：
   * 已完成/下载中/暂停/失败都能重下；**合并中拒绝**并给出原版那句警告。
   */
  app.post("/api/tasks/:id/redownload", async (c) => {
    const manager = getManager();
    const id = c.req.param("id");
    if (!manager.redownloadTask) {
      return c.json({ error: { code: "NOT_FOUND", message: "重新下载接口不可用" } }, 404);
    }
    const result = await manager.redownloadTask(id);
    if (!result.ok) {
      if (result.reason === "ffmpeg") {
        return c.json({ error: { code: "FFMPEG_BUSY", message: "处于 FFmpeg 处理中的任务无法重新下载" } }, 409);
      }
      return c.json({ error: { code: "NOT_FOUND", message: "任务不存在" } }, 404);
    }
    return c.json({ ok: true, task: result.task });
  });

  app.post("/api/tasks/:id/delete", async (c) => {
    const manager = getManager();
    const ok = await manager.deleteTask(c.req.param("id"));
    if (!ok) return c.json({ error: { code: "NOT_FOUND", message: "任务不存在" } }, 404);
    return c.json({ ok: true });
  });

  app.get("/api/tasks/:id/log", (c) => {
    const manager = getManager();
    const id = c.req.param("id");
    const task = manager.getTask(id);
    if (!task) return c.json({ error: { code: "NOT_FOUND", message: "任务不存在" } }, 404);
    return c.json({ lines: manager.taskLog(id) ?? [] });
  });

  app.get("/api/history", (c) => c.json({ history: getManager().listHistory() }));

  // 解析历史（已解析过的链接列表）
  app.get("/api/parse-history", (c) => {
    const manager = getManager();
    if (!manager.listParseHistory) {
      return c.json({ error: { code: "NOT_FOUND", message: "接口不可用" } }, 404);
    }
    return c.json({ history: manager.listParseHistory() });
  });

  app.delete("/api/parse-history/:id", (c) => {
    const manager = getManager();
    if (!manager.deleteParseHistory) {
      return c.json({ error: { code: "NOT_FOUND", message: "接口不可用" } }, 404);
    }
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) {
      return c.json({ error: { code: "INVALID_PATH", message: "id 非法" } }, 400);
    }
    const ok = manager.deleteParseHistory(id);
    if (!ok) return c.json({ error: { code: "NOT_FOUND", message: "解析记录不存在" } }, 404);
    return c.json({ ok: true });
  });

  app.delete("/api/history/:taskId", (c) => {
    const manager = getManager();
    const ok = manager.deleteHistory(c.req.param("taskId"));
    if (!ok) return c.json({ error: { code: "NOT_FOUND", message: "历史记录不存在" } }, 404);
    return c.json({ ok: true });
  });

  app.get("/api/files/raw", async (c) => {
    const manager = getManager();
    const rel = c.req.query("path") ?? "";
    if (rel.length === 0) {
      return c.json({ error: { code: "INVALID_PATH", message: "缺少 path 参数" } }, 400);
    }
    const abs = manager.resolveDownloadFile(rel);
    if (!abs) {
      return c.json({ error: { code: "INVALID_PATH", message: "路径越界或非法" } }, 400);
    }
    let st;
    try {
      st = await stat(abs);
    } catch {
      return c.json({ error: { code: "NOT_FOUND", message: "文件不存在" } }, 404);
    }
    if (st.isDirectory()) {
      return c.json({ error: { code: "INVALID_PATH", message: "不能下载目录" } }, 400);
    }
    c.header("Content-Type", "application/octet-stream");
    /**
     * 必须显式给文件名：不给的话浏览器只能按 URL 末段取名 —— 我们的下载地址是
     * `/api/files/raw?path=…`，于是**下下来就是一个叫 `raw`、没有扩展名的文件**
     *（实测踩到：用户在下载文件夹里只看到一个 495 MB 的 `raw`，双击打不开）。
     * 中文名走 RFC 5987 的 `filename*`，同时给一个 ASCII 兜底。
     */
    const name = basename(abs);
    c.header(
      "Content-Disposition",
      `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    );
    return stream(c, async (s) => {
      const rs = createReadStream(abs);
      for await (const chunk of rs) {
        await s.write(chunk as Uint8Array);
      }
      rs.destroy();
    });
  });

  /**
   * 「保存到本机」：把投递目录里的产物推给浏览器。
   *
   * 与 `/api/files/raw` 的区别：① 只能按**任务 id** 取（不接受任意路径）；
   * ② 只能取投递目录里的文件（`deliverFilePath` 三重校验）；
   * ③ **推完即删服务器副本** —— 用户选「本机」就不在服务器上留一份。
   *
   * 删除放在流结束之后：读流 loop 走完说明字节都已交给响应；若此时删不掉
   *（Windows 上句柄可能还没释放），留给 `sweepDeliverDir` 的 24h 清理兜底，不影响用户。
   */
  app.get("/api/deliver/raw", async (c) => {
    const manager = getManager();
    const taskId = c.req.query("taskId") ?? "";
    if (!taskId) return c.json({ error: { code: "INVALID_PATH", message: "缺少 taskId" } }, 400);
    const abs = manager.deliverFilePath?.(taskId);
    if (!abs) return c.json({ error: { code: "NOT_FOUND", message: "投递产物不存在或已被取走" } }, 404);
    const name = basename(abs);
    c.header("Content-Type", "application/octet-stream");
    c.header(
      "Content-Disposition",
      `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    );
    return stream(c, async (s) => {
      const rs = createReadStream(abs);
      for await (const chunk of rs) {
        await s.write(chunk as Uint8Array);
      }
      rs.destroy();
      await manager.removeDelivered?.(taskId, abs);
    });
  });

  // 登录（SESSDATA cookie）：账户向（稍后再看/历史/高画质）需要
  app.get("/api/auth/status", async (c) => {
    const manager = getManager();
    if (!manager.authStatus) return c.json({ loggedIn: false, preview: "" });
    return c.json(await manager.authStatus());
  });
  // 收藏夹面板：kind=created（我创建的，默认）/ collected（我订阅的，对应原版「订阅合集」）
  app.get("/api/favorites", async (c) => {
    const manager = getManager();
    if (!manager.listFavFolders) return c.json({ error: { code: "NOT_FOUND", message: "收藏夹接口不可用" } }, 404);
    try {
      const kind = c.req.query("kind") === "collected" ? "collected" : "created";
      return c.json(await manager.listFavFolders(kind));
    } catch (err) {
      const { status, body } = errorBody(err);
      return c.json(body, status);
    }
  });
  /**
   * 收藏夹封面（我创建的收藏夹那条接口**不返回** cover，得逐个取 `fav/resource/list` 的 info.cover）。
   * 单独一个接口是为了"列表先出来、封面随后填"，服务端限并发 3 + 缓存，避免把接口打到 412。
   */
  app.get("/api/favorites/covers", async (c) => {
    const manager = getManager();
    if (!manager.listFavFolderCovers) return c.json({ covers: {} });
    const ids = (c.req.query("ids") ?? "")
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0)
      .slice(0, 60);
    if (ids.length === 0) return c.json({ covers: {} });
    try {
      const covers = await manager.listFavFolderCovers(ids);
      // JSON 的键是字符串，客户端按 string 取
      return c.json({ covers: Object.fromEntries(Object.entries(covers).map(([k, v]) => [k, v])) });
    } catch (err) {
      const { status, body } = errorBody(err);
      return c.json(body, status);
    }
  });
  // 追番面板：type=1 追番 / 2 追剧；status=0 全部 / 1 想看 / 2 在看 / 3 看过；pn 分页
  app.get("/api/bangumi/follow", async (c) => {
    const manager = getManager();
    if (!manager.listFollowBangumi) return c.json({ error: { code: "NOT_FOUND", message: "追番接口不可用" } }, 404);
    try {
      const type = c.req.query("type") ?? "1";
      const status = Number(c.req.query("status") ?? 0) || 0;
      const pn = Number(c.req.query("pn") ?? 1) || 1;
      return c.json(await manager.listFollowBangumi(type, status, pn));
    } catch (err) {
      const { status, body } = errorBody(err);
      return c.json(body, status);
    }
  });


  app.post("/api/auth", async (c) => {
    const manager = getManager();
    if (!manager.loginAuth) return c.json({ error: { code: "NOT_FOUND", message: "登录接口不可用" } }, 404);
    try {
      const body = (await c.req.json()) as { sessdata?: string };
      if (!body.sessdata?.trim()) {
        return c.json({ error: { code: "INVALID_AUTH", message: "SESSDATA 不能为空" } }, 400);
      }
      return c.json(await manager.loginAuth(body.sessdata));
    } catch (err) {
      const { status, body } = errorBody(err);
      return c.json(body, status);
    }
  });

  app.delete("/api/auth", async (c) => {
    const manager = getManager();
    if (!manager.logoutAuth) return c.json({ loggedIn: false, preview: "" });
    return c.json(await manager.logoutAuth());
  });
  app.post("/api/auth/qr", async (c) => {
    const manager = getManager();
    if (!manager.qrLoginStart) return c.json({ error: { code: "NOT_FOUND", message: "扫码登录不可用" } }, 404);
    try {
      return c.json(await manager.qrLoginStart());
    } catch (err) {
      const { status, body } = errorBody(err);
      return c.json(body, status);
    }
  });

  app.post("/api/auth/qr/poll", async (c) => {
    const manager = getManager();
    if (!manager.qrLoginPoll) return c.json({ error: { code: "NOT_FOUND", message: "扫码登录轮询不可用" } }, 404);
    try {
      const body = (await c.req.json()) as { qrcodeKey?: string };
      if (!body.qrcodeKey?.trim()) {
        return c.json({ error: { code: "INVALID_AUTH", message: "qrcodeKey 不能为空" } }, 400);
      }
      return c.json(await manager.qrLoginPoll(body.qrcodeKey));
    } catch (err) {
      const { status, body } = errorBody(err);
      return c.json(body, status);
    }
  });

  // 全局设置（P3：附加内容默认 + 文件命名/编号）
  app.get("/api/config", async (c) => {
    const manager = getManager();
    if (!manager.getConfig) return c.json({ error: { code: "NOT_FOUND", message: "配置接口不可用" } }, 404);
    return c.json({ config: await manager.getConfig() });
  });

  /**
   * MCP 服务器运行状态（进程级，不在配置里）。
   * 桌面版把 `mcp_running` / `mcp_last_error` 放在全局信号里给设置卡显示（`01 §11.13`），同款用途。
   */
  app.get("/api/mcp/status", (c) => {
    const st = extra?.mcpStatus?.() ?? { running: false, lastError: "" };
    return c.json(st);
  });

  /** 导出配置（下载一个 config.json） */
  app.get("/api/config/export", async (c) => {
    const manager = getManager();
    if (!manager.exportConfig) return c.json({ error: { code: "NOT_FOUND", message: "配置接口不可用" } }, 404);
    const config = await manager.exportConfig();
    c.header("content-disposition", 'attachment; filename="bili23-web-config.json"');
    return c.json(config);
  });

  /** 导入配置：净化 + 校验通过才落盘 */
  app.post("/api/config/import", async (c) => {
    const manager = getManager();
    if (!manager.importConfig) return c.json({ error: { code: "NOT_FOUND", message: "配置接口不可用" } }, 404);
    try {
      const body = (await c.req.json()) as { config?: unknown } | unknown;
      const raw = (typeof body === "object" && body !== null && "config" in (body as Record<string, unknown>))
        ? (body as { config?: unknown }).config
        : body;
      return c.json({ config: await manager.importConfig(raw) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: { code: "INVALID_CONFIG", message } }, 400);
    }
  });

  /** 重置为默认配置 */
  app.post("/api/config/reset", async (c) => {
    const manager = getManager();
    if (!manager.resetConfig) return c.json({ error: { code: "NOT_FOUND", message: "配置接口不可用" } }, 404);
    return c.json({ config: await manager.resetConfig() });
  });
  app.put("/api/config", async (c) => {    const manager = getManager();
    if (!manager.updateConfig) return c.json({ error: { code: "NOT_FOUND", message: "配置接口不可用" } }, 404);
    try {
      const body = (await c.req.json()) as { config?: AppConfigPatch };
      const config = await manager.updateConfig(body.config ?? {});
      return c.json({ config });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: { code: "INVALID_CONFIG", message } }, 400);
    }
  });

  /**
   * 代理测试（原版「设置代理服务器」弹窗的「测试」按钮）。
   * 用**请求体里当前表单的值**测，而不是已保存的配置 —— 原版也是测表单当前值，
   * 这样用户可以"先试再存"。
   */
  app.post("/api/proxy/test", async (c) => {
    const manager = getManager();
    if (!manager.testProxy) return c.json({ error: { code: "NOT_FOUND", message: "代理测试不可用" } }, 404);
    try {
      const body = (await c.req.json()) as Partial<{ proxyType: string; proxyServer: string; proxyPort: number; proxyUname: string; proxyPassword: string }>;
      const result = await manager.testProxy({
        proxyType: body.proxyType === "http" ? "http" : "http",
        proxyServer: typeof body.proxyServer === "string" ? body.proxyServer : "",
        proxyPort: typeof body.proxyPort === "number" ? body.proxyPort : 80,
        proxyUname: typeof body.proxyUname === "string" ? body.proxyUname : "",
        proxyPassword: typeof body.proxyPassword === "string" ? body.proxyPassword : "",
      });
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: message } satisfies ProxyTestResult);
    }
  });
}

