import { Hono } from "hono";
import { DownloadManager } from "./download-manager.js";
import { registerApi } from "./routes.js";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

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

const CLIENT_DIR = join(process.cwd(), "dist", "client");

/** 静态资源 MIME（只覆盖前端产物需要的类型） */
function contentTypes(path: string): string {
  if (path.endsWith(".js")) return "application/javascript";
  if (path.endsWith(".css")) return "text/css";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".ico")) return "image/x-icon";
  if (path.endsWith(".woff2")) return "font/woff2";
  if (path.endsWith(".html")) return "text/html";
  return "application/octet-stream";
}

export function createApp(opts: CreateAppOptions = {}) {
  const app = new Hono();
  const getManager = (): DownloadManager => opts.manager ?? getDefaultManager();

  app.get("/api/health", (c) => c.json({ ok: true }));
  registerApi(app, getManager);

  // 前端 SPA（hash 路由）：托管 dist/client 静态文件，非 /api/* 且非静态文件时回退 index.html
  if (existsSync(CLIENT_DIR)) {
    app.get("/assets/*", async (c) => {
      const file = await import("node:fs/promises").then((m) =>
        m.readFile(join(CLIENT_DIR, "assets", c.req.path.replace(/^\/assets\//, ""))),
      );
      return new Response(file, { headers: { "Content-Type": contentTypes(c.req.path) } });
    });
    app.get("*", (c) => {
      const path = new URL(c.req.url).pathname;
      if (path.startsWith("/api")) return c.notFound();
      let resolved = join(CLIENT_DIR, path.replace(/^\/+/, ""));
      if (!existsSync(resolved) || resolved === CLIENT_DIR) {
        resolved = join(CLIENT_DIR, "index.html");
      }
      return new Response(readFileSync(resolved), { headers: { "Content-Type": contentTypes(resolved) } });
    });
  }

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