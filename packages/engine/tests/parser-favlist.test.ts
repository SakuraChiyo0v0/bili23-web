import { describe, expect, it } from "vitest";
import { HttpClient } from "../src/api/http.js";
import { BiliError } from "../src/errors.js";
import { FavlistParser } from "../src/parser/favlist.js";
import { classifyUrl } from "../src/url.js";
import { parseUrl } from "../src/parser/index.js";
import type { ParseContext } from "../src/parser/types.js";

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function viewData(bvid: string, aid: number, cid: number, title: string, pages: Array<{ cid: number; page: number; part: string; duration: number }>) {
  return {
    code: 0,
    data: {
      bvid, aid, cid, title,
      pic: `http://i0.hdslb.com/${bvid}.jpg`,
      duration: 100, pubdate: 1600000000, desc: "desc",
      owner: { mid: 9, name: "UP", face: "" },
      pages,
    },
  };
}

function makeCtx(over: { medias?: unknown[]; folderTitle?: string; urls?: string[] } = {}) {
  const urls: string[] = [];
  const medias = over.medias ?? [];
  const viewByBvid: Record<string, unknown> = {
    BV1aa: viewData("BV1aa", 1001, 9001, "收藏视频A", [{ cid: 9001, page: 1, part: "收藏视频A", duration: 100 }]),
    BV2bb: viewData("BV2bb", 1002, 9002, "收藏视频B", [
      { cid: 9101, page: 1, part: "分P-1", duration: 30 },
      { cid: 9102, page: 2, part: "分P-2", duration: 40 },
    ]),
  };
  const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/x/v3/fav/resource/list")) {
      return json({ code: 0, data: { info: { id: 456, title: over.folderTitle ?? "我的收藏", media_count: 3 }, medias } });
    }
    if (url.includes("/x/web-interface/view")) {
      const bvid = new URL(url).searchParams.get("bvid");
      if (bvid && viewByBvid[bvid]) return json(viewByBvid[bvid]);
      return json({ code: -404, message: "稿件不存在", data: null });
    }
    return json({ code: -404, message: "not found" });
  };
  return { http: new HttpClient({ fetchImpl: fetchImpl as typeof fetch }), urls };
}

const SAMPLE_MEDIAS = [
  { id: 1, bvid: "BV1aa", title: "收藏视频A", cover: "http://i0.hdslb.com/a.jpg", pubtime: 1600000000, fav_time: 1600000001, page: 1, duration: 100 },
  { id: 2, bvid: "BV2bb", title: "收藏视频B", cover: "http://i0.hdslb.com/b.jpg", pubtime: 1600000000, fav_time: 1600000002, page: 2, duration: 70 },
  { id: 3, bvid: "BV3cc", title: "某番剧", intro: "简介", ogv: { type_name: "番剧" } },
  { id: 4, title: "无 bvid 行" },
];

describe("classifyUrl favlist", () => {
  it("识别空间收藏夹与 ml 链接", () => {
    expect(classifyUrl("https://space.bilibili.com/123/favlist?fid=456")).toEqual({ type: "favlist", token: "123" });
    expect(classifyUrl("https://www.bilibili.com/list/ml789")).toEqual({ type: "favlist", token: "789" });
    expect(classifyUrl("https://space.bilibili.com/2/lists")).toEqual({ type: "list", token: "2" });
  });
});

describe("FavlistParser", () => {
  it("fid 链接：请求收藏夹列表并把视频行平铺为分P 叶子，ogv/无 bvid 行跳过", async () => {
    const ctx = makeCtx({ medias: SAMPLE_MEDIAS });
    const result = await new FavlistParser().parse({ http: ctx.http }, "https://space.bilibili.com/123/favlist?fid=456");
    expect(result.type).toBe("favlist");
    expect(result.title).toBe("我的收藏");
    const req = ctx.urls.find((u) => u.includes("/x/v3/fav/resource/list"));
    expect(req).toContain("media_id=456");
    expect(req).toContain("ps=40");
    expect(req).toContain("order=mtime");
    expect(result.items.map((i) => i.id)).toEqual(["video:BV1aa:p1", "video:BV2bb:p1", "video:BV2bb:p2"]);
    const a = result.items.find((i) => i.bvid === "BV1aa");
    expect(a).toMatchObject({ groupTitle: "收藏视频A", title: "收藏视频A", cid: 9001 });
    expect(result.items.find((i) => i.bvid === "BV3cc")).toBeUndefined();
    expect(result.pagination).toMatchObject({ total: 3, page: 1, pageSize: 40, totalPages: 1 });
  });

  it("ml 链接：media_id 取 ml 后的数字", async () => {
    const ctx = makeCtx({ medias: SAMPLE_MEDIAS });
    await new FavlistParser().parse({ http: ctx.http }, "https://www.bilibili.com/list/ml789");
    const req = ctx.urls.find((u) => u.includes("/x/v3/fav/resource/list"));
    expect(req).toContain("media_id=789");
  });

  it("keyword 随链接传递并进入请求与标题", async () => {
    const ctx = makeCtx({ medias: [SAMPLE_MEDIAS[0]] });
    const result = await new FavlistParser().parse({ http: ctx.http }, "https://space.bilibili.com/123/favlist?fid=456&keyword=BV1aa");
    const req = ctx.urls.find((u) => u.includes("/x/v3/fav/resource/list"));
    expect(req).toContain("keyword=BV1aa");
    expect(result.title).toBe("我的收藏 - 搜索“BV1aa”");
  });

  it("缺少 fid/ml 的收藏夹页抛 INVALID_URL", async () => {
    const ctx = makeCtx();
    await expect(new FavlistParser().parse({ http: ctx.http }, "https://space.bilibili.com/123/favlist")).rejects.toMatchObject({ code: "INVALID_URL" });
  });

  it("接口业务错误映射 API_ERROR", async () => {
    const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
      if (String(input).includes("/x/v3/fav/resource/list")) {
        return json({ code: -403, message: "没有访问权限", data: null });
      }
      return json({ code: -404 });
    };
    const ctx: ParseContext = { http: new HttpClient({ fetchImpl: fetchImpl as typeof fetch }) };
    await expect(new FavlistParser().parse(ctx, "https://www.bilibili.com/list/ml1")).rejects.toMatchObject({ code: "API_ERROR", apiCode: -403 });
  });

  it("parseUrl 分发 favlist 链接", async () => {
    const ctx = makeCtx({ medias: SAMPLE_MEDIAS });
    const result = await parseUrl({ http: ctx.http }, "https://space.bilibili.com/123/favlist?fid=456");
    expect(result.type).toBe("favlist");
    expect(result.items.length).toBeGreaterThan(0);
  });
});