import { describe, expect, it } from "vitest";
import { HttpClient } from "../src/api/http.js";
import { buvidFpHex, ensureAnonymousSession, makeBLsid, makeUuid } from "../src/api/session.js";
import type { ParseContext } from "../src/parser/types.js";

/** 参考值由上游 auth/cookie.py 的 murmur3_x64_128 用 Python 3.14 生成（seed=31） */
describe("buvidFpHex（murmur3_x64_128 seed=31）", () => {
  it.each([
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36", "483007aebf0fc624a0841fd1f51b42a1"],
    ["", "24700f9f1986800ab4fcc880530dd0ed"],
    ["abc", "f04961ae49bab9266bb906b7e9ce9afb"],
    ["a".repeat(32), "2b61e77754fadcfdd78334b02d48a9b2"],
    ["b".repeat(17), "85494dd38c42546a35529e70ad813795"],
    ["x".repeat(15), "6ebd7a0def30303e7b9dd4bb187b64c1"],
    ["y".repeat(16), "93d88e9895c4dbe011dd015e47e1adc2"],
    ["z".repeat(33), "83cdde2918d1ce6739e2c705f4e67b1f"],
    ["1234567890abcdefghij", "24e11fd9e8ff82a868baa0cd491b4d01"],
    ["short", "9100bdbcc9c2e3dbc1f27a718948afdf"],
  ])("%s", (key, expected) => {
    expect(buvidFpHex(key)).toBe(expected);
  });
});

describe("本地生成型 cookie", () => {
  it("makeUuid 结构：5 段 + 5 位时间 + infoc（段内 token 长度 1-2 不等）", () => {
    const u = makeUuid(1_600_000_000);
    expect(u).toMatch(/^[0-9A-F]+(-[0-9A-F]+){4}\d{5}infoc$/);
    expect(u.endsWith("00000infoc")).toBe(true); // 1600000000 % 100000 = 0
  });

  it("makeBLsid：8 位十六进制 + _ + 时间戳十六进制", () => {
    const v = makeBLsid(1_600_000_000);
    expect(v).toMatch(/^[0-9A-F]{8}_[0-9A-F]+$/);
  });
});

describe("ensureAnonymousSession", () => {
  it("从 spi/ticket 接口取数并写入 cookie jar", async () => {
    let ticketUrl = "";
    const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      if (url.includes("/x/frontend/finger/spi")) {
        return new Response(JSON.stringify({ code: 0, data: { b_3: "ABC3", b_4: "ABC4" } }), { status: 200 });
      }
      if (url.includes("GenWebTicket")) {
        ticketUrl = url;
        return new Response(JSON.stringify({ code: 0, data: { ticket: "TICKET-1", expires_in: 259200 } }), { status: 200 });
      }
      return new Response(JSON.stringify({ code: -404 }), { status: 200 });
    };
    const http = new HttpClient({ fetchImpl: fetchImpl as typeof fetch });
    await ensureAnonymousSession({ http });

    expect(http.jar.get("buvid3")).toBe("ABC3");
    expect(http.jar.get("buvid4")).toBe("ABC4");
    expect(http.jar.get("_uuid")?.endsWith("infoc")).toBe(true);
    expect(http.jar.get("b_lsid")).toMatch(/^[0-9A-F]{8}_[0-9A-F]+$/);
    expect(http.jar.get("b_nut")).toMatch(/^\d+$/);
    expect(http.jar.get("buvid_fp")).toMatch(/^[0-9a-f]{32}$/);
    expect(http.jar.get("CURRENT_FNVAL")).toBe("4048");
    expect(http.jar.get("CURRENT_QUALITY")).toBe("0");
    expect(http.jar.get("bili_ticket")).toBe("TICKET-1");
    expect(http.jar.get("bili_ticket_expires")).toMatch(/^\d+$/);
    expect(ticketUrl).toContain("key_id=ec02");
    expect(ticketUrl).toContain("csrf=");
    expect(ticketUrl).toContain("context%5Bts%5D=");
  });

  it("接口失败时最佳努力：不抛异常，只落下本地生成的 cookie", async () => {
    const http = new HttpClient({
      fetchImpl: (async () => new Response("{}", { status: 500 })) as typeof fetch,
    });
    await expect(ensureAnonymousSession({ http })).resolves.toBeUndefined();
    expect(http.jar.get("buvid3")).toBeUndefined();
    expect(http.jar.get("buvid_fp")).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("ensureAnonymousSession 与解析器共用 ctx", () => {
  it("context 类型兼容（仅编译期检查）", () => {
    const ctx: ParseContext = { http: new HttpClient() };
    expect(ctx.http.ua.length).toBeGreaterThan(0);
  });
});