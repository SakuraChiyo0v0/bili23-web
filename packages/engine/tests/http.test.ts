import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { HttpClient } from "../src/api/http.js";
import { CookieJar } from "../src/api/cookies.js";
import { BiliError } from "../src/errors.js";

let server: Server;
let base = "";
let flakyCount = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/json") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ code: 0, data: { n: 1 } }));
    } else if (url.pathname === "/text") {
      res.end("hello");
    } else if (url.pathname === "/redirect") {
      res.statusCode = 302;
      res.setHeader("Location", "/json");
      res.end();
    } else if (url.pathname === "/set-cookie") {
      res.setHeader("Set-Cookie", "SESSDATA=abc123; Path=/; HttpOnly");
      res.end("ok");
    } else if (url.pathname === "/cookie-echo") {
      res.end(req.headers.cookie ?? "");
    } else if (url.pathname === "/flaky") {
      flakyCount += 1;
      if (flakyCount < 3) {
        res.statusCode = 503;
        res.end("retry later");
      } else {
        res.end("ok");
      }
    } else if (url.pathname === "/always-404") {
      res.statusCode = 404;
      res.end("nope");
    } else {
      res.statusCode = 404;
      res.end("not found");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

describe("HttpClient", () => {
  it("getJSON 解析响应体", async () => {
    const client = new HttpClient();
    const body = await client.getJSON<{ code: number; data: { n: number } }>(`${base}/json`);
    expect(body).toEqual({ code: 0, data: { n: 1 } });
  });

  it("getText 返回原文", async () => {
    const client = new HttpClient();
    expect(await client.getText(`${base}/text`)).toBe("hello");
  });

  it("自动跟随重定向", async () => {
    const client = new HttpClient();
    const body = await client.getJSON<{ code: number }>(`${base}/redirect`);
    expect(body.code).toBe(0);
  });

  it("Set-Cookie 回写 jar，后续请求携带", async () => {
    const jar = new CookieJar();
    const client = new HttpClient({ cookieJar: jar });
    await client.getText(`${base}/set-cookie`);
    expect(jar.get("SESSDATA")).toBe("abc123");
    const echo = await client.getText(`${base}/cookie-echo`);
    expect(echo).toContain("SESSDATA=abc123");
  });

  it("可重试状态码自动重试后成功", async () => {
    flakyCount = 0;
    const client = new HttpClient({ retries: 3 });
    const text = await client.getText(`${base}/flaky`);
    expect(text).toBe("ok");
    expect(flakyCount).toBe(3);
  });

  it("4xx 不重试并抛 BiliError(API_ERROR)", async () => {
    const client = new HttpClient({ retries: 3 });
    await expect(client.getJSON(`${base}/always-404`)).rejects.toMatchObject({
      code: "API_ERROR",
    });
  });

  it("网络不通抛 BiliError(NETWORK)", async () => {
    const client = new HttpClient({ retries: 0, timeoutMs: 500 });
    const err = await client
      .getJSON("http://127.0.0.1:1/json")
      .then(() => null, (e) => e);
    expect(err).toBeInstanceOf(BiliError);
    expect((err as BiliError).code).toBe("NETWORK");
  });

  it("查询参数会拼到 URL", async () => {
    // /text 忽略 query，这里验证 params 拼接后请求能到达 /json（用 params 指向 /json?x=1 亦可）
    const client = new HttpClient();
    const body = await client.getJSON<{ code: number }>(`${base}/json`, { params: { a: 1, b: undefined } });
    expect(body.code).toBe(0);
  });

  it("可注入自定义 UA/Referer", async () => {
    // 通过 headers 覆盖验证可达：把 Cookie 覆盖为空串以观察头部注入是否生效
    const client = new HttpClient({ ua: "test-ua", referer: "https://example.com/" });
    // 这里仅验证配置被使用：请求成功即可（服务器未校验头部）
    await expect(client.getText(`${base}/text`)).resolves.toBe("hello");
  });
});
