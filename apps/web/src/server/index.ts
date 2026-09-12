import { Hono } from "hono";
import { DownloadManager } from "./download-manager.js";
import { initLogger, logInfo, logWarn } from "./logger.js";
import { registerApi } from "./routes.js";
import { join } from "node:path";

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";


export interface CreateAppOptions {
  /** 测试注入 manager；缺省按环境变量懒加载默认实例 */
  manager?: DownloadManager;
}

let defaultManager: DownloadManager | undefined;
/** MCP 控制器的当前状态（供 `/api/mcp/status` 读；没启用时是 undefined） */
let mcpStatusProvider: (() => { running: boolean; lastError: string }) | undefined;

/** 默认 manager：数据目录 BILI23_DATA_DIR（默认 ./data），下载目录 DOWNLOAD_DIR（默认 <data>/downloads） */
function getDefaultManager(): DownloadManager {
  if (!defaultManager) {
    const dataDir = process.env.BILI23_DATA_DIR ?? join(process.cwd(), "data");
    const downloadDir = process.env.DOWNLOAD_DIR;
    // 日志与桌面版同构：<data>/logs/app.log（午夜切割，留 15 份）
    initLogger(join(dataDir, "logs"));
    defaultManager = new DownloadManager({
      dataDir,
      ...(downloadDir ? { downloadDir } : {}),
    });
    /**
     * 「保存到本机」的投递目录：启动扫一次 + 每小时扫一次，把超过 24h 还没被拉走的产物清掉
     *（用户选了「本机」却一直没取回时，别让它在服务器上一直占空间）。
     * `unref()` 让这个定时器不阻塞进程退出。
     */
    void defaultManager.sweepDeliverDir();
    setInterval(() => { void defaultManager?.sweepDeliverDir(); }, 60 * 60 * 1000).unref?.();
  }
  return defaultManager;
}

const CLIENT_DIR = process.cwd() + sep + join("dist", "client");

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

/** 解析到 dist/client 内路径；若越界返回 undefined（防目录穿越） */
function safeClientPath(rel: string): string | undefined {
  const abs = resolve(CLIENT_DIR, rel);
  return abs === CLIENT_DIR || abs.startsWith(CLIENT_DIR + sep) ? abs : undefined;
}

export function createApp(opts: CreateAppOptions = {}) {
  const app = new Hono();
  const getManager = (): DownloadManager => opts.manager ?? getDefaultManager();

  app.get("/api/health", (c) => c.json({ ok: true }));
  registerApi(app, getManager, {
    mcpStatus: () => mcpStatusProvider?.() ?? { running: false, lastError: "" },
  });

  // 前端 SPA（hash 路由）：托管 dist/client 静态文件，非 /api/* 且非静态文件时回退 index.html
  if (existsSync(CLIENT_DIR)) {
    app.get("/assets/*", async (c) => {
      const rel = "assets/" + c.req.path.replace(/^\/assets\//, "");
      const abs = safeClientPath(rel);
      if (!abs) return c.notFound();
      try {
        const file = await import("node:fs/promises").then((m) => m.readFile(abs));
        return new Response(file, { headers: { "Content-Type": contentTypes(c.req.path) } });
      } catch {
        return c.notFound();
      }
    });
    app.get("*", (c) => {
      const path = new URL(c.req.url).pathname;
      if (path.startsWith("/api")) return c.notFound();
      const abs = safeClientPath(path.replace(/^\/+/, ""));
      if (abs && existsSync(abs) && statSync(abs).isFile()) {
        return new Response(readFileSync(abs), { headers: { "Content-Type": contentTypes(abs) } });
      }
      // 目录/空 path/未知路径 → 回退 index.html（SPA hash 路由）
      return new Response(readFileSync(resolve(CLIENT_DIR, "index.html")), { headers: { "Content-Type": "text/html" } });
    });
  }

  return app;
}

const app = createApp();

/**
 * MCP 服务器 —— 独立端口（原版 `mcp_port`，默认 23330），与原版同构：
 * 它是给 AI 客户端用的，暴露面应当与 Web UI **分开控制**
 * （用户可以只把 UI 放局域网，而 MCP 保持回环）。
 * 未启用时**连模块都不加载**（原版 `main.py:501-523` 也是这个意思）。
 *
 * 启停交给 `McpController`：配置一变就重启（原版 `card.py:708-709`）。
 * 没有它的话设置页那个开关"拨了不生效"，就是个假开关。
 */
async function startMcpIfEnabled(): Promise<void> {
  const manager = getDefaultManager();
  const { McpController } = await import("./mcp.js");
  const controller = new McpController(manager);
  mcpStatusProvider = () => ({ running: controller.running, lastError: controller.lastError });
  manager.onConfigChange(() => controller.apply());
  await controller.apply();
}

if (process.env.NODE_ENV !== "test") {
  // 监听前先恢复遗留任务（download_task → interrupted，幂等），保证重启后任务可继续
  await getDefaultManager().init();
  const port = Number(process.env.PORT ?? 8787);
  const { serve } = await import("@hono/node-server");
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`[bili23-web] listening on http://localhost:${info.port}`);
  });
  await startMcpIfEnabled();
}

export default app;