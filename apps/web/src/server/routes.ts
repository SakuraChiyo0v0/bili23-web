import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { BiliError } from "@bili23-web/engine";
import type { ParseResult } from "@bili23-web/engine";
import type {
  AppConfig,
} from "./config.js";
import type {
  DownloadOptions,
  FileEntry,
  MediaOptionSummary,
  TaskSummary,
} from "./download-manager.js";

/**
 * REST + SSE 路由。
 * - POST /api/parse          {urls}           → 解析结果（含条目）
 * - GET  /api/media/:itemId                   → 可选画质/编码/音质
 * - POST /api/download       {itemIds,options,force} → 创建任务（重复项返回提示）
 * - GET  /api/tasks                          → 全部任务
 * - GET  /api/tasks/:id/events               → SSE 进度
 * - POST /api/tasks/:id/cancel               → 取消
 * - GET  /api/files                          → 产物目录
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
  listFiles(): Promise<FileEntry[]>;
  getConfig?(): Promise<AppConfig>;
  updateConfig?(patch: Partial<AppConfig>): Promise<AppConfig>;
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

export function registerApi(app: Hono, getManager: () => ApiDeps): void {
  app.post("/api/parse", async (c) => {
    try {
      const body = (await c.req.json()) as { urls?: string[] };
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
      const body = (await c.req.json()) as { config?: Partial<AppConfig> };
      const config = await manager.updateConfig(body.config ?? {});
      return c.json({ config });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: { code: "INVALID_CONFIG", message } }, 400);
    }
  });
}

