import { describe, expect, it, beforeEach } from "vitest";
import { rm } from "node:fs/promises";
import { onCleanup, tmpDir } from "./helpers/tmp.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpService, bearerToken, tokenMatches } from "../src/server/mcp.js";
import { ConfigStore, defaultAppConfig, generateMcpToken, validateConfig } from "../src/server/config.js";
import { DownloadManager } from "../src/server/download-manager.js";

/**
 * MCP 服务器（原版 `src/util/mcp/`）：
 * 鉴权是**定长比较**、工具失败走 `isError`、协议层交给官方 SDK。
 * 这里按 JSON-RPC 真实走一遍 —— 只测"我们自己写的那部分"，不重测 SDK。
 */

/** Windows 上 SQLite 句柄仍持有 task.db，直接 rm 会 EBUSY；测试只需要"尽量清掉" */
async function cleanup(dir: string): Promise<void> {
  try { await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); } catch { /* 句柄未释放就留着 */ }
}

const TOKEN = "test-token-0123456789abcdefghijklmnopqrstuvwxyz";

function rpc(method: string, params?: unknown, id = 1): Request {
  return new Request("http://127.0.0.1:23330/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${TOKEN}`,
      "MCP-Protocol-Version": "2025-06-18",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
}

async function makeService(): Promise<{ service: McpService; dir: string; manager: DownloadManager }> {
  const dir = await tmpDir("bili23-mcp-");
  const manager = new DownloadManager({ dataDir: dir });
  // 用完必须关：它开着 SQLite（task.db），Windows 上不关就删不掉这个临时目录
  onCleanup(() => manager.close());
  await manager.getConfig();   // 触发配置加载
  return { service: new McpService(manager), dir, manager };
}

describe("MCP 令牌校验", () => {
  it("bearerToken 只认 Bearer 形态", () => {
    expect(bearerToken("Bearer abc")).toBe("abc");
    expect(bearerToken("bearer  abc ")).toBe("abc");
    expect(bearerToken("Basic abc")).toBeUndefined();
    expect(bearerToken(undefined)).toBeUndefined();
  });

  it("tokenMatches：定长比较，长度不同/空期望值都 false", () => {
    expect(tokenMatches("abc", "abc")).toBe(true);
    expect(tokenMatches("abc", "abd")).toBe(false);
    expect(tokenMatches("abc", "abcd")).toBe(false);   // 长度不同
    expect(tokenMatches("", "")).toBe(false);          // 未配置令牌 = 谁都不放行
  });

  it("令牌是 32 字节的 base64url（长度与原版 token_urlsafe(32) 同量级）", () => {
    const t = generateMcpToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateMcpToken()).not.toBe(t);
  });
});

describe("配置校验：MCP 相关", () => {
  it("启用但没令牌 → 拒绝（否则任何能连端口的人都能建任务）", () => {
    const cfg = defaultAppConfig();
    cfg.advanced.mcpEnabled = true;
    cfg.advanced.mcpToken = "";
    expect(validateConfig(cfg).some((e) => e.includes("mcpToken"))).toBe(true);
  });

  it("端口越界 / 非法绑定地址 → 拒绝", () => {
    const bad = defaultAppConfig();
    bad.advanced.mcpPort = 80;
    expect(validateConfig(bad).some((e) => e.includes("mcpPort"))).toBe(true);
    const badAddr = defaultAppConfig();
    badAddr.advanced.mcpBindAddress = "10.0.0.5";
    expect(validateConfig(badAddr).some((e) => e.includes("mcpBindAddress"))).toBe(true);
  });

  it("默认关闭、端口 23330、回环地址（与原版一致）", async () => {
    const dir = await tmpDir("bili23-mcp-cfg-");
    try {
      const store = new ConfigStore(join(dir, "config.json"));
      await store.load();
      const ad = store.get().advanced;
      expect(ad.mcpEnabled).toBe(false);
      expect(ad.mcpPort).toBe(23330);
      expect(ad.mcpBindAddress).toBe("127.0.0.1");
      expect(ad.mcpToken).toBe("");
    } finally {
      await cleanup(dir);
    }
  });
});

describe("MCP 端点（JSON-RPC 真实往返）", () => {
  let service: McpService;
  let dir: string;

  beforeEach(async () => {
    const made = await makeService();
    service = made.service;
    dir = made.dir;
  });

  it("没有/错误令牌 → 401 且带 WWW-Authenticate", async () => {
    const noAuth = await service.handle(rpc("initialize"), undefined, TOKEN);
    expect(noAuth.status).toBe(401);
    expect(noAuth.headers.get("WWW-Authenticate")).toContain("Bearer");

    const wrong = await service.handle(rpc("initialize"), "wrong-token-0123456789abcdefghijklmnopqrstuvwxyz", TOKEN);
    expect(wrong.status).toBe(401);
    await cleanup(dir);
  });

  it("initialize 握手成功，返回服务器名", async () => {
    const res = await service.handle(rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "vitest", version: "0" },
    }), TOKEN, TOKEN);
    expect(res.status).toBe(200);
    const body = await res.json() as { result?: { serverInfo?: { name?: string } } };
    expect(body.result?.serverInfo?.name).toBe("bili23-web");
    await cleanup(dir);
  });

  it("tools/list 返回原版的 9 个工具（parse → task → download）", async () => {
    const res = await service.handle(rpc("tools/list"), TOKEN, TOKEN);
    const body = await res.json() as { result?: { tools?: Array<{ name: string }> } };
    const names = (body.result?.tools ?? []).map((t) => t.name);
    expect(names).toEqual([
      "parse_url", "get_episodes",
      "list_tasks", "get_task_status", "get_login_status",
      "create_download", "pause_task", "resume_task", "cancel_task",
    ]);
    await cleanup(dir);
  });

  it("list_tasks 真调通（空任务列表返回 0 条，不是报错）", async () => {
    const res = await service.handle(rpc("tools/call", { name: "list_tasks", arguments: {} }), TOKEN, TOKEN);
    const body = await res.json() as { result?: { content?: Array<{ text: string }>; isError?: boolean } };
    expect(body.result?.isError).toBeFalsy();
    const payload = JSON.parse(body.result?.content?.[0]?.text ?? "{}") as { total?: number };
    expect(payload.total).toBe(0);
  });

  it("工具失败走 isError（内容错误），不是 JSON-RPC error —— 拿不存在的任务试试", async () => {
    const res = await service.handle(rpc("tools/call", { name: "get_task_status", arguments: { task_id: "nope" } }), TOKEN, TOKEN);
    const body = await res.json() as { result?: { isError?: boolean; content?: Array<{ text: string }> }; error?: unknown };
    expect(body.error).toBeUndefined();          // 不是协议层错误
    expect(body.result?.isError).toBe(true);     // 而是内容层的 isError
    expect(body.result?.content?.[0]?.text).toContain("没有这个任务");
    await cleanup(dir);
  });

  it("create_download：episode_ids 没对上条目时给出可操作的提示", async () => {
    const res = await service.handle(rpc("tools/call", { name: "create_download", arguments: { episode_ids: ["1"] } }), TOKEN, TOKEN);
    const body = await res.json() as { result?: { isError?: boolean; content?: Array<{ text: string }> } };
    expect(body.result?.isError).toBe(true);
    expect(body.result?.content?.[0]?.text).toContain("先调用 parse_url");
    await cleanup(dir);
  });
});
