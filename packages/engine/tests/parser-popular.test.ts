import { describe, expect, it } from "vitest";
import { HttpClient } from "../src/api/http.js";
import { resetWbiKeyCache } from "../src/media/wbi-keys.js";
import { BiliError } from "../src/errors.js";
import { PopularParser } from "../src/parser/popular.js";
import { classifyUrl } from "../src/url.js";
import { parseUrl } from "../src/parser/index.js";
import { beforeEach } from "vitest";
import type { ParseContext } from "../src/parser/types.js";

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function makeCtx(over: { list?: unknown[]; label?: string; viewCount?: number[] } = {}) {
  const urls: string[] = [];
  const viewCount: number[] = over.viewCount ?? [];
  const list = over.list ?? [
    { aid: 11, bvid: "BV1aa", cid: 9001, pic: "http://i0.hdslb.com/a.jpg", title: "周榜视频A", duration: 120, pubdate: 1600000000 },
    { aid: 12, bvid: "BV2bb", cid: 9002, pic: "http://i0.hdslb.com/b.jpg", title: "周榜视频B", duration: 60, pubdate: 1600000001 },
  ];
  const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/x/web-interface/nav")) {
      return json({ code: 0, data: { wbi_img: { img_url: "https://i0.hdslb.com/bfs/wbi/aaa.png", sub_url: "https://i0.hdslb.com/bfs/wbi/bbb.png" } } });
    }
    if (url.includes("/x/web-interface/popular/series/one")) {
      return json({ code: 0, data: { config: { label: over.label ?? "每周必看·第1期" }, list } });
    }
    if (url.includes("/x/web-interface/view")) viewCount.push(1);
    return json({ code: -404 });
  };
  return { http: new HttpClient({ fetchImpl: fetchImpl as typeof fetch }), urls };
}

beforeEach(() => resetWbiKeyCache());

describe("classifyUrl popular", () => {
  it("识别每周必看链接", () => {
    expect(classifyUrl("https://www.bilibili.com/v/popular/weekly?num=1")).toEqual({ type: "popular", token: "" });
  });
});

describe("PopularParser", () => {
  it("num=1：请求周榜并把自带 cid 的条目直接映射为视频叶子（不发 view）", async () => {
    const viewCount: number[] = [];
    const ctx = makeCtx({ viewCount });
    const result = await new PopularParser().parse({ http: ctx.http }, "https://www.bilibili.com/v/popular/weekly?num=1");

    const req = ctx.urls.find((u) => u.includes("/x/web-interface/popular/series/one"));
    expect(req).toContain("number=1");
    expect(result.type).toBe("popular");
    expect(result.title).toBe("每周必看·第1期");
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      id: "video:BV1aa:p1", type: "video", aid: 11, bvid: "BV1aa", cid: 9001,
      page: 1, title: "周榜视频A", groupTitle: "周榜视频A", duration: 120,
      url: "https://www.bilibili.com/video/BV1aa",
    });
    expect(viewCount).toHaveLength(0); // 周榜行自带 cid，无需二次解析
  });

  it("缺少 num 参数抛 INVALID_URL", async () => {
    const ctx = makeCtx();
    await expect(new PopularParser().parse({ http: ctx.http }, "https://www.bilibili.com/v/popular")).rejects.toMatchObject({ code: "INVALID_URL" });
  });

  it("接口业务错误映射 API_ERROR", async () => {
    const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      if (url.includes("/x/web-interface/nav")) return json({ code: 0, data: { wbi_img: { img_url: "https://i0.hdslb.com/bfs/wbi/aaa.png", sub_url: "https://i0.hdslb.com/bfs/wbi/bbb.png" } } });
      if (url.includes("/x/web-interface/popular/series/one")) return json({ code: -404, message: "期数不存在" });
      return json({ code: -404 });
    };
    const ctx: ParseContext = { http: new HttpClient({ fetchImpl: fetchImpl as typeof fetch }) };
    await expect(new PopularParser().parse(ctx, "https://www.bilibili.com/v/popular/weekly?num=99999")).rejects.toMatchObject({ code: "API_ERROR", apiCode: -404 });
  });

  it("parseUrl 分发 popular 链接", async () => {
    const ctx = makeCtx();
    const result = await parseUrl({ http: ctx.http }, "https://www.bilibili.com/v/popular/weekly?num=1");
    expect(result.type).toBe("popular");
    expect(result.items.length).toBeGreaterThan(0);
  });
});