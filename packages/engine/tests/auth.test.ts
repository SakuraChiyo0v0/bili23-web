import { describe, expect, it } from "vitest";
import { HttpClient } from "../src/api/http.js";
import { QRCodeStatus, qrGenerate, qrPoll, type QRGenerateResult } from "../src/api/auth.js";

describe("QR 扫码登录 /api/auth", () => {
  it("qrGenerate 返回二维码 url 与 qrcode_key，且不写入登录 cookie", async () => {
    const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      expect(url).toContain("/x/passport-login/web/qrcode/generate");
      expect(url).toContain("source=main-fe-header");
      return new Response(
        JSON.stringify({
          code: 0,
          data: { url: "https://www.bilibili.com/??qr_login=123", qrcode_key: "abcd1234" },
        }),
        { status: 200 },
      );
    };
    const http = new HttpClient({ fetchImpl: fetchImpl as typeof fetch });
    const out: QRGenerateResult = await qrGenerate(http);
    expect(out.url).toContain("qr_login");
    expect(out.qrcodeKey).toBe("abcd1234");
    // 生成阶段不应写入 SESSDATA（登录尚未成功）
    expect(http.jar.get("SESSDATA")).toBeUndefined();
  });

  it("qrPoll 在确认登录（code 0）时把 SESSDATA/bili_jct/DedeUserID 写入 cookie jar", async () => {
    const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      expect(url).toContain("/x/passport-login/web/qrcode/poll");
      expect(url).toContain("qrcode_key=abcd1234");
      const body = new Response(
        JSON.stringify({ code: 0, data: { code: 0, message: "扫码成功", url: "https://www.bilibili.com/" } }),
        { status: 200, headers: { "Set-Cookie": "SESSDATA=abc123; Path=/; Domain=.bilibili.com" } },
      );
      return body;
    };
    const http = new HttpClient({ fetchImpl: fetchImpl as typeof fetch });
    // set-cookie 由 HttpClient 捕获进 jar
    const status = await qrPoll(http, "abcd1234");
    expect(status).toBe(QRCodeStatus.SUCCESS);
    expect(http.jar.get("SESSDATA")).toBe("abc123");
  });

  it("qrPoll 状态码正确映射：86101 未扫 / 86090 已扫待确认 / 86038 过期 / 0 成功", async () => {
    let code = 86101;
    const fetchImpl = async (): Promise<Response> => {
      return new Response(JSON.stringify({ code: 0, data: { code, message: "" } }), { status: 200 });
    };
    const http = new HttpClient({ fetchImpl: fetchImpl as typeof fetch });
    expect(await qrPoll(http, "key")).toBe(QRCodeStatus.UNSCANNED);
    code = 86090;
    expect(await qrPoll(http, "key")).toBe(QRCodeStatus.CONFIRM_PENDING);
    code = 86038;
    expect(await qrPoll(http, "key")).toBe(QRCodeStatus.EXPIRED);
    expect(http.jar.get("SESSDATA")).toBeUndefined();
  });
});
