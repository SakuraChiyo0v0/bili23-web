import { Hono } from "hono";
import { stream, streamSSE } from "hono/streaming";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { BiliError } from "@bili23-web/engine";
import type { ParseResult, ParseHistoryEntry } from "@bili23-web/engine";
import type {
  AppConfig,
  AppConfigPatch,
} from "./config.js";
import type {
  DownloadOptions,
  DirEntry,
  FileEntry,
  HistoryEntryDto,
  MediaOptionSummary,
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
 * - POST /api/tasks/:id/delete               → 删除任务（含历史行与 .tmp）
 * - GET  /api/tasks/:id/log                  → 任务生命周期日志
 * - GET  /api/history                        → 已完成历史（completed_task）
 * - DELETE /api/history/:taskId              → 删除单条历史记录
 * - GET  /api/files                          → 产物目录
 * - GET  /api/files/raw?path=...             → 产物文件下载（防目录穿越）
 */

export interface ApiDeps {
  parseUrls(urls: string[]): Promise<ParseResult[]>;
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
  deleteTask(id: string): Promise<boolean>;
  listHistory(): HistoryEntryDto[];
  deleteHistory(taskId: string): boolean;
  taskLog(id: string): string[] | undefined;
  resolveDownloadFile(relPath: string): string | undefined;
  listFiles(): Promise<FileEntry[]>;
  listSubdirs?(absDir: string): Promise<DirEntry[]>;
  getConfig?(): Promise<AppConfig>;
  updateConfig?(patch: AppConfigPatch): Promise<AppConfig>;
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
  listFavFolders?(): Promise<{ mid: number; folders: Array<{ id: number; title: string; mediaCount: number; cover: string }> }>;
  listFollowBangumi?(type?: string): Promise<Array<{ seasonId: number; title: string; cover: string; newEp: string; progress: string; isFinish: number; url: string }>>;
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

export function registerApi(app: Hono, getManager: () => ApiDeps): void {
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
      const results = await getManager().parseUrls(urls);
      return c.json({ results });
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

  /** 目录选择器：列出指定绝对目录的子目录（下载目录浏览用；路径越界/不存在返回空列表） */
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
    return stream(c, async (s) => {
      const rs = createReadStream(abs);
      for await (const chunk of rs) {
        await s.write(chunk as Uint8Array);
      }
      rs.destroy();
    });
  });

  // 登录（SESSDATA cookie）：账户向（稍后再看/历史/高画质）需要
  app.get("/api/auth/status", async (c) => {
    const manager = getManager();
    if (!manager.authStatus) return c.json({ loggedIn: false, preview: "" });
    return c.json(await manager.authStatus());
  });
  app.get("/api/favorites", async (c) => {
    const manager = getManager();
    if (!manager.listFavFolders) return c.json({ error: { code: "NOT_FOUND", message: "收藏夹接口不可用" } }, 404);
    try {
      return c.json(await manager.listFavFolders());
    } catch (err) {
      const { status, body } = errorBody(err);
      return c.json(body, status);
    }
  });
  app.get("/api/bangumi/follow", async (c) => {
    const manager = getManager();
    if (!manager.listFollowBangumi) return c.json({ error: { code: "NOT_FOUND", message: "追番接口不可用" } }, 404);
    try {
      const type = c.req.query("type") ?? "1";
      return c.json({ follow: await manager.listFollowBangumi(type) });
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

  app.put("/api/config", async (c) => {
    const manager = getManager();
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
}

