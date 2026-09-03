import { describe, expect, it } from "vitest";
import { HttpClient } from "../src/api/http.js";
import { ListParser } from "../src/parser/list.js";
import { parseUrl } from "../src/parser/index.js";
import type { ParseContext } from "../src/parser/types.js";

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function viewData(bvid: string, aid: number, cid: number, title: string, pages: Array<{ cid: number; page: number; part: string; duration: number }>) {
  return {
    code: 0,
    data: { bvid, aid, cid, title, pic: `http://i0.hdslb.com/${bvid}.jpg`, duration: 100, pubdate: 1600000000, desc: "desc", owner: { mid: 9, name: "UP", face: "" }, pages },
  };
}

function makeCtx(over: { season?: boolean; archives?: Array<{ aid: number; bvid: string; title?: string; duration?: number; pubdate?: number }>; metaTitle?: string } = {}) {
  const urls: string[] = [];
  const viewByBvid: Record<string, unknown> = {
    BV1aa: viewData("BV1aa", 1001, 9001, "合集视频A", [{ cid: 9001, page: 1, part: "合集视频A", duration: 100 }]),
    BV2bb: viewData("BV2bb", 1002, 9002, "合集视频B", [
      { cid: 9101, page: 1, part: "分P-1", duration: 30 },
      { cid: 9102, page: 2, part: "分P-2", duration: 40 },
    ]),
  };
  const archives = over.archives ?? [
    { aid: 1001, bvid: "BV1aa", title: "合集视频A", duration: 100, pubdate: 1600000000 },
    { aid: 1002, bvid: "BV2bb", title: "合集视频B", duration: 70, pubdate: 1600000000 },
  ];
  const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/x/polymer/web-space/seasons_archives_list")) {
      return json({ code: 0, data: { archives, meta: { title: over.metaTitle ?? "我的合集" }, page: { total: 2 } } });
    }
    if (url.includes("/x/series/archives")) {
      return json({ code: 0, data: { archives, page: { total: 2 } } });
    }
    if (url.includes("/x/series/series")) {
      return json({ code: 0, data: { meta: { title: over.metaTitle ?? "我的系列" } } });
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

describe("ListParser", () => {
  it("type=season：走 seasons_archives_list 并按 bvid 展开分P", async () => {
    const ctx = makeCtx({ season: true });
    const result = await new ListParser().parse(
      { http: ctx.http },
      "https://space.bilibili.com/123/lists/456?type=season",
    );
    expect(result.type).toBe("list");
    expect(result.title).toBe("我的合集");
    const req = ctx.urls.find((u) => u.includes("/x/polymer/web-space/seasons_archives_list"));
    expect(req).toContain("season_id=456");
    expect(req).toContain("page_size=30");
    expect(req).toContain("page_num=1");
    expect(result.items.map((i) => i.id)).toEqual(["video:BV1aa:p1", "video:BV2bb:p1", "video:BV2bb:p2"]);
    expect(result.items[0]).toMatchObject({ containerType: "list", collectionTitle: "我的合集" });
    expect(result.pagination?.totalPages).toBe(1);
  });

  it("type=series：走 x/series/archives 并额外取 meta 标题", async () => {
    const ctx = makeCtx();
    const result = await new ListParser().parse(
      { http: ctx.http },
      "https://space.bilibili.com/123/lists/789?type=series",
    );
    expect(result.title).toBe("我的系列");
    const req = ctx.urls.find((u) => u.includes("/x/series/archives"));
    expect(req).toContain("series_id=789");
    expect(req).toContain("current_mid=0");
    expect(ctx.urls.some((u) => u.includes("/x/series/series"))).toBe(true);
    expect(result.items).toHaveLength(3);
  });

  it("sid= 链接按系列处理", async () => {
    const ctx = makeCtx();
    const result = await new ListParser().parse({ http: ctx.http }, "https://www.bilibili.com/list/789?sid=123");
    const req = ctx.urls.find((u) => u.includes("/x/series/archives"));
    expect(req).toContain("series_id=123");
    expect(result.type).toBe("list");
  });

  it("parseUrl 分发 list 类型", async () => {
    const ctx = makeCtx({ season: true });
    const result = await parseUrl({ http: ctx.http }, "https://space.bilibili.com/123/lists/456?type=season");
    expect(result.type).toBe("list");
    expect(result.items.length).toBeGreaterThan(0);
  });
});
