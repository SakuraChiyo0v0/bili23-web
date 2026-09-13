import { describe, expect, it } from "vitest";
import { createApp } from "../src/server/index.js";

describe("health endpoint", () => {
  it("GET /api/health 返回 ok，并带上构建版本（用于确认部署到了哪一版）", async () => {
    const app = createApp();
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; version: string; commit: string };
    expect(json.ok).toBe(true);
    // 本地/测试环境没注入构建参数 → 回退 "dev"；Docker 镜像里由 CI 注入真实版本与 commit。
    // 断言"有值"而不是写死，否则 CI 注入后会失败。
    expect(typeof json.version).toBe("string");
    expect(json.version.length).toBeGreaterThan(0);
    expect(typeof json.commit).toBe("string");
  });
});
