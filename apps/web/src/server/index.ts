import { Hono } from "hono";
import { DownloadManager } from "./download-manager.js";
import { registerApi } from "./routes.js";
import { join } from "node:path";

export interface CreateAppOptions {
  /** 测试注入 manager；缺省按环境变量懒加载默认实例 */
  manager?: DownloadManager;
}

let defaultManager: DownloadManager | undefined;

/** 默认 manager：数据目录 BILI23_DATA_DIR（默认 ./data），下载目录 DOWNLOAD_DIR（默认 <data>/downloads） */
function getDefaultManager(): DownloadManager {
  if (!defaultManager) {
    const dataDir = process.env.BILI23_DATA_DIR ?? join(process.cwd(), "data");
    const downloadDir = process.env.DOWNLOAD_DIR;
    defaultManager = new DownloadManager({
      dataDir,
      ...(downloadDir ? { downloadDir } : {}),
    });
  }
  return defaultManager;
}

export function createApp(opts: CreateAppOptions = {}) {
  const app = new Hono();
  const getManager = (): DownloadManager => opts.manager ?? getDefaultManager();

  app.get("/api/health", (c) => c.json({ ok: true }));
  registerApi(app, getManager);

  return app;
}

const app = createApp();

if (process.env.NODE_ENV !== "test") {
  // 监听前先恢复遗留任务（download_task → interrupted，幂等），保证重启后任务可继续
  await getDefaultManager().init();
  const port = Number(process.env.PORT ?? 8787);
  const { serve } = await import("@hono/node-server");
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`[bili23-web] listening on http://localhost:${info.port}`);
  });
}

export default app;
