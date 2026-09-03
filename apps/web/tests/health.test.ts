import { describe, expect, it } from "vitest";
import { createApp } from "../src/server/index.js";

describe("health endpoint", () => {
  it("GET /api/health 返回 { ok: true }", async () => {
    const app = createApp();
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
