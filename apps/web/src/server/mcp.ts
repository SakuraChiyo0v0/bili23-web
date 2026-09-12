import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AUDIO_QUALITY, VIDEO_CODEC, VIDEO_QUALITY } from "@bili23-web/engine";
import type { DownloadOptions } from "./download-manager.js";
import type { DownloadManager } from "./download-manager.js";
import { logInfo, logWarn } from "./logger.js";

/**
 * MCP 服务器 —— 对齐桌面版 `src/util/mcp/`：
 *
 * - 传输：Streamable HTTP，单端点 `POST /mcp`（`mcp/server.py:18`）
 * - 鉴权：`Authorization: Bearer <mcp_token>`，**定长比较**防时序侧信道（`server.py:160-181`）
 * - 工具：9 个，注册顺序 parse → task → download（`mcp/tools/__init__.py:95-109`）
 * - 工具执行失败走 `isError`（内容错误），不走 JSON-RPC error（`tools/__init__.py:33-40`）
 *
 * 协议层（版本协商、`Mcp-Method`/`Mcp-Name` 头一致性、dual-era 兼容）**交给官方 SDK**，
 * 不手写 —— 那正是成熟库该负责的部分。
 *
 * ⚠️ 与原版的差异（归档里写明）：
 * - 桌面版把工具调用 `call_in_main_thread` 转回 GUI 线程；Web 端没有 GUI 线程，直接调 manager
 *  （manager 本身异步且并发安全）。
 * - `episode_id` 语义与原版一致：**解析列表里的位置序号（从 1 开始）**。
 */

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

function text(body: unknown): ToolResult {
  return { content: [{ type: "text", text: typeof body === "string" ? body : JSON.stringify(body, null, 2) }] };
}

function fail(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** 定长比较（长度不同直接 false；令牌长度固定，长度本身不是秘密） */
export function tokenMatches(provided: string, expected: string): boolean {
  if (!expected) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** 从请求头取 Bearer 令牌 */
export function bearerToken(header: string | null | undefined): string | undefined {
  if (!header) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1]!.trim() : undefined;
}

interface EpisodeRef { itemId: string; title: string; badge?: string }

export class McpService {
  #manager: DownloadManager;
  #episodes: EpisodeRef[] = [];
  #lastError = "";
  #running = false;

  constructor(manager: DownloadManager) {
    this.#manager = manager;
  }

  get running(): boolean { return this.#running; }
  get lastError(): string { return this.#lastError; }
  get episodes(): EpisodeRef[] { return this.#episodes; }

  /** 构建 MCP server（原版注册顺序：parse → task → download） */
  #build(): McpServer {
    const server = new McpServer({ name: "bili23-web", version: "0.1.0" });
    const mgr = this.#manager;
    const episodeList = (cap: number) => this.#episodes.slice(0, cap).map((e, i) => ({
      episode_id: String(i + 1), title: e.title, badge: e.badge ?? "",
    }));

    // ---------- parse ----------
    server.registerTool("parse_url", {
      title: "解析链接",
      description: "解析 B 站链接并把剧集列表载入解析列表",
      inputSchema: { url: z.string().describe("B 站链接"), limit: z.number().int().min(1).max(500).optional() },
    }, async ({ url, limit }) => {
      try {
        const results = await mgr.parseUrls([url]);
        const items = results.flatMap((r) => r.items);
        this.#episodes = items.map((it) => ({ itemId: it.id, title: it.title || it.groupTitle, badge: it.badge }));
        const cap = limit ?? 100;
        return text({ total: items.length, episodes: episodeList(cap), truncated: items.length > cap });
      } catch (e) {
        return fail(`解析失败：${e instanceof Error ? e.message : String(e)}`);
      }
    });

    server.registerTool("get_episodes", {
      title: "列出解析结果",
      description: "列出当前解析列表中的条目及其 episode_id",
      inputSchema: { limit: z.number().int().min(1).max(500).optional() },
    }, async ({ limit }) => text({ total: this.#episodes.length, episodes: episodeList(limit ?? 100) }));

    // ---------- task ----------
    server.registerTool("list_tasks", {
      title: "列出下载任务",
      description: "列出下载任务及状态/进度",
      inputSchema: {
        state: z.enum(["downloading", "completed", "all"]).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
    }, async ({ state, limit }) => {
      const all = mgr.listTasks();
      const want = state ?? "downloading";
      const filtered = want === "all"
        ? all
        : all.filter((t) => (want === "completed" ? t.status === "completed" : t.status !== "completed"));
      return text({
        total: filtered.length,
        tasks: filtered.slice(0, limit ?? 30).map((t) => ({
          task_id: t.id, title: t.title, status: t.status, progress: t.progress,
          downloaded_bytes: t.downloadedBytes, total_bytes: t.totalBytes,
          quality: t.qualityLabel, error: t.error ?? "",
        })),
      });
    });

    server.registerTool("get_task_status", {
      title: "任务详情",
      description: "单个任务详情（含输出文件路径、画质、时间戳）",
      inputSchema: { task_id: z.string() },
    }, async ({ task_id }) => {
      const t = mgr.getTask(task_id);
      if (!t) return fail(`没有这个任务：${task_id}`);
      return text({
        task_id: t.id, title: t.title, status: t.status, progress: t.progress,
        output_path: t.outputPath ?? "", quality: t.qualityLabel,
        downloaded_bytes: t.downloadedBytes, total_bytes: t.totalBytes,
        created_at: t.createdAt, updated_at: t.updatedAt, error: t.error ?? "",
      });
    });

    server.registerTool("get_login_status", {
      title: "登录状态",
      description: "查询是否已登录、用户名、uid、会话是否过期",
      inputSchema: {},
    }, async () => {
      const st = await mgr.authStatus();
      return text({ logged_in: st.loggedIn, username: st.uname ?? "", uid: st.mid ?? 0, session_expired: false });
    });

    // ---------- download ----------
    server.registerTool("create_download", {
      title: "创建下载任务",
      description: "为解析列表中的条目创建下载任务",
      inputSchema: {
        episode_ids: z.array(z.string()).min(1).max(200),
        options: z.object({
          video_quality: z.string().optional(),
          audio_quality: z.string().optional(),
          video_codec: z.string().optional(),
          container: z.enum(["mp4", "mkv"]).optional(),
        }).optional(),
        redownload: z.boolean().optional(),
      },
    }, async ({ episode_ids, options, redownload }) => {
      const ids = episode_ids
        .map((id) => this.#episodes[Number(id) - 1]?.itemId)
        .filter((v): v is string => Boolean(v));
      if (!ids.length) return fail("episode_ids 没有对上任何条目；先调用 parse_url 或 get_episodes");
      const opts: DownloadOptions = {};
      const vq = options?.video_quality as keyof typeof VIDEO_QUALITY | undefined;
      const aq = options?.audio_quality as keyof typeof AUDIO_QUALITY | undefined;
      const vc = options?.video_codec as keyof typeof VIDEO_CODEC | undefined;
      if (vq && vq in VIDEO_QUALITY) opts.videoQualityId = VIDEO_QUALITY[vq];
      if (aq && aq in AUDIO_QUALITY) opts.audioQualityId = AUDIO_QUALITY[aq];
      if (vc && vc in VIDEO_CODEC) opts.videoCodecId = VIDEO_CODEC[vc];
      if (options?.container) opts.container = options.container;
      try {
        // 重复下载就地决策（redownload=true 视为强制重下），避免自动化链路里等弹窗
        const res = await mgr.createTasks(ids, opts, redownload === true);
        return text({ created: res.tasks.length, task_ids: res.tasks.map((t) => t.id), duplicates: res.duplicates.map((d) => d.title) });
      } catch (e) {
        return fail(`创建任务失败：${e instanceof Error ? e.message : String(e)}`);
      }
    });

    // 循环注册 pause / resume / cancel（原版 `download.py:707-718` 就是循环注册 `f"{action}_task"`）
    const actions = [
      { name: "pause_task", title: "暂停任务", desc: "暂停正在下载的任务", run: (id: string) => mgr.pauseTask(id) },
      { name: "resume_task", title: "继续任务", desc: "继续已暂停的任务", run: (id: string) => mgr.resumeTask(id) },
      { name: "cancel_task", title: "取消任务", desc: "取消任务并从队列移除", run: (id: string) => { mgr.cancelTask(id); return true; } },
    ] as const;
    for (const a of actions) {
      server.registerTool(a.name, {
        title: a.title,
        description: a.desc,
        inputSchema: { task_id: z.string() },
      }, async ({ task_id }) => {
        try {
          const ok = a.run(task_id);
          return ok ? text({ ok: true, task_id, action: a.name }) : fail(`操作失败（任务不存在或当前状态不允许）：${task_id}`);
        } catch (e) {
          return fail(`操作失败：${e instanceof Error ? e.message : String(e)}`);
        }
      });
    }

    return server;
  }

  /**
   * 处理一个 MCP HTTP 请求。**无状态**：每个请求新建 server + transport。
   * Streamable HTTP 支持 JSON 响应 + 无会话模式；桌面版单用户长连接才需要会话，
   * Web 端每请求独立更简单、也更抗并发。
   */
  async handle(request: Request, token: string | undefined, expectedToken: string): Promise<Response> {
    if (!tokenMatches(token ?? "", expectedToken)) {
      return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null }), {
        status: 401,
        headers: { "content-type": "application/json", "WWW-Authenticate": 'Bearer realm="bili23-web-mcp"' },
      });
    }
    const server = this.#build();
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await server.connect(transport);
    try {
      return await transport.handleRequest(request);
    } finally {
      await transport.close().catch(() => undefined);
    }
  }

  /** 客户端配置（HTTP 直连）/（stdio 桥接的说明见归档：Web 端没有本机进程可桥） */
  clientConfigHttp(port: number, token: string): string {
    return JSON.stringify({ type: "http", url: `http://127.0.0.1:${port}/mcp`, headers: { Authorization: `Bearer ${token}` } }, null, 2);
  }

  markRunning(running: boolean, error?: string): void {
    this.#running = running;
    this.#lastError = error ?? "";
    if (running) logInfo("mcp", "MCP 服务器已启动");
    else if (error) logWarn("mcp", `MCP 服务器未启动：${error}`);
  }
}

/** 正在监听的 MCP HTTP 服务句柄（`@hono/node-server` 的 serve 返回值） */
interface ListeningServer { close(cb?: (err?: Error) => void): void }

/**
 * MCP 生命期控制 —— 对齐原版"开关/端口/令牌任一变化就重启服务器"
 *（`card.py:708-709,791-797`；`setting.py:320-324`）。
 *
 * 没有这个控制器的话，设置页的开关"拨了不生效"（要重启进程才行）—— 那就是个假开关。
 * 判据：**配置里与监听相关的三元组（enabled/port/bindAddress）只要变了就重启**；
 * 令牌变化**不需要**重启（每个请求都按当前令牌校验），但原版也是重启，这里跟随原版保持一致行为。
 */
export class McpController {
  #manager: DownloadManager;
  #server: ListeningServer | undefined;
  #service?: McpService;
  #signature = "";

  constructor(manager: DownloadManager) {
    this.#manager = manager;
  }

  get running(): boolean { return Boolean(this.#server); }
  get lastError(): string { return this.#service?.lastError ?? ""; }

  /** 按当前配置应用（启动/停止/重启）。可反复调用。 */
  async apply(): Promise<void> {
    const cfg = await this.#manager.getConfig();
    const { mcpEnabled, mcpPort, mcpBindAddress, mcpToken } = cfg.advanced;
    const signature = `${mcpEnabled}|${mcpPort}|${mcpBindAddress}|${mcpToken ? "tok" : ""}`;
    if (signature === this.#signature) return;   // 无关字段变化不折腾
    this.#signature = signature;

    await this.stop();
    if (!mcpEnabled) return;
    if (!mcpToken) {
      this.#service?.markRunning(false, "缺少访问令牌");
      logWarn("mcp", "已启用但缺少访问令牌，未启动");
      return;
    }

    const { Hono } = await import("hono");
    const { bearerToken } = await import("./mcp.js");
    const service = new McpService(this.#manager);
    this.#service = service;
    const app = new Hono();
    app.all("/mcp", (c) => service.handle(c.req.raw, bearerToken(c.req.header("authorization")), mcpToken));
    try {
      const { serve } = await import("@hono/node-server");
      const handle = serve({ fetch: app.fetch, port: mcpPort, hostname: mcpBindAddress }, (info) => {
        service.markRunning(true);
        logInfo("mcp", `MCP 监听 ${mcpBindAddress}:${info.port}/mcp`);
        console.log(`[bili23-web] MCP on http://${mcpBindAddress}:${info.port}/mcp`);
      });
      this.#server = handle as unknown as ListeningServer;
    } catch (e) {
      // 端口占用等：只记日志与状态，不拖垮进程（原版 `server.py:400-407`）
      service.markRunning(false, e instanceof Error ? e.message : String(e));
      logWarn("mcp", `MCP 启动失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async stop(): Promise<void> {
    const s = this.#server;
    this.#server = undefined;
    if (!s) return;
    await new Promise<void>((resolve) => {
      try { s.close(() => resolve()); } catch { resolve(); }
    });
    this.#service?.markRunning(false);
    logInfo("mcp", "MCP 服务器已停止");
  }
}
