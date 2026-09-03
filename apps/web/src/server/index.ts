import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** 生产模式静态目录：apps/web/dist/client（vite build 产物） */
const CLIENT_DIR = join(__dirname, "../client");

export function createApp() {
  const app = new Hono();

  app.get("/api/health", (c) => c.json({ ok: true }));

  // 生产模式托管前端构建产物；开发模式由 Vite(5173) 代理 /api
  if (existsSync(join(CLIENT_DIR, "index.html"))) {
    app.use("/*", serveStatic({ root: CLIENT_DIR }));
    app.get("*", serveStatic({ path: "./dist/client/index.html" }));
  }

  return app;
}

const app = createApp();

if (process.env.NODE_ENV !== "test") {
  const port = Number(process.env.PORT ?? 8787);
  const { serve } = await import("@hono/node-server");
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`[bili23-web] listening on http://localhost:${info.port}`);
  });
}

export default app;
