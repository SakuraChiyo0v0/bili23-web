import { describe, expect, it } from "vitest";
import { HttpClient } from "../src/api/http.js";
import { VideoParser } from "../src/parser/video.js";
import { parseUrl } from "../src/parser/index.js";
import { BiliError } from "../src/errors.js";
import type { ParseContext } from "../src/parser/types.js";

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

/** 用本地 fixture 替代真实网络：fetchImpl 返回给定 JSON */
function httpWithJson(body: unknown, opts: { url?: string } = {}): HttpClient {
  const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
    const called = String(input);
    const finalUrl = opts.url ?? called;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return new HttpClient({ fetchImpl: fetchImpl as typeof fetch });
}

const VIEW_MULTI_P = {
  code: 0,
  data: {
    bvid: "BV1xx411c7mD",
    aid: 170001,
    cid: 280001,
    title: "测试视频标题",
    pic: "http://i0.hdslb.com/bfs/archive/cover.jpg",
    duration: 100,
    pubdate: 1600000000,
    desc: "描述文本",
    owner: { mid: 1, name: "UP主", face: "http://i0.hdslb.com/face.jpg" },
    pages: [
      { cid: 280001, page: 1, part: "P1 标题", duration: 60 },
      { cid: 280002, page: 2, part: "P2 标题", duration: 40 },
    ],
  },
};

describe("VideoParser", () => {
  it("分P 视频：每个分P 生成一条 MediaItem", async () => {
    const ctx: ParseContext = { http: httpWithJson(VIEW_MULTI_P) };
    const parser = new VideoParser();
    const result = await parser.parse(
      ctx,
      "https://www.bilibili.com/video/BV1xx411c7mD",
    );

    expect(result.type).toBe("video");
    expect(result.title).toBe("测试视频标题");
    expect(result.items).toHaveLength(2);

    const first = result.items[0];
    expect(first).toMatchObject({
      id: "video:BV1xx411c7mD:p1",
      aid: 170001,
      bvid: "BV1xx411c7mD",
      cid: 280001,
      page: 1,
      title: "P1 标题",
      groupTitle: "测试视频标题",
      duration: 60,
      badge: "",
      pubtime: 1600000000,
      owner: { mid: 1, name: "UP主", face: "http://i0.hdslb.com/face.jpg" },
      desc: "描述文本",
      url: "https://www.bilibili.com/video/BV1xx411c7mD?p=1",
    });
    expect(result.items[1]?.id).toBe("video:BV1xx411c7mD:p2");
    expect(result.items[1]?.cid).toBe(280002);
  });

  it("单P 视频（无 pages）生成一条 page=1 条目", async () => {
    const body = {
      code: 0,
      data: {
        ...VIEW_MULTI_P.data,
        pages: undefined,
      },
    };
    const ctx: ParseContext = { http: httpWithJson(body) };
    const result = await new VideoParser().parse(ctx, "BV1xx411c7mD");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ page: 1, cid: 280001, title: "测试视频标题" });
  });

  it("互动视频（rights.is_stein_gate=1）按 BFS 展开为分支节点叶子", async () => {
    const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      if (url.includes("/x/web-interface/nav")) {
        return json({ code: 0, data: { wbi_img: { img_url: "https://i0.hdslb.com/bfs/wbi/abc.png", sub_url: "https://i0.hdslb.com/bfs/wbi/def.png" } } });
      }
      if (url.includes("/x/player/wbi/v2")) {
        return json({ code: 0, data: { interaction: { graph_version: "1" } } });
      }
      if (url.includes("/x/stein/edgeinfo_v2")) {
        const edgeId = new URL(url).searchParams.get("edge_id");
        if (edgeId === "0") {
          return json({ code: 0, data: { title: "根节点", edges: { questions: [{ type: 1, choices: [{ id: 1, option: "A", cid: 100 }, { id: 2, option: "B", cid: 200 }] }] } } });
        }
        if (edgeId === "1") return json({ code: 0, data: { title: "分支A", edges: { questions: [] } } });
        if (edgeId === "2") return json({ code: 0, data: { title: "分支B", edges: { questions: [] } } });
        return json({ code: -404, message: "node not found", data: null });
      }
      if (url.includes("/x/web-interface/view")) {
        return json({ code: 0, data: { ...VIEW_MULTI_P.data, rights: { is_stein_gate: 1 }, pages: undefined } });
      }
      return json({ code: -404, message: "not found", data: null });
    };
    const ctx: ParseContext = { http: new HttpClient({ fetchImpl: fetchImpl as typeof fetch }) };
    const result = await new VideoParser().parse(ctx, "BV1xx411c7mD");
    expect(result.items).toHaveLength(3);
    const ids = result.items.map((i) => i.id);
    expect(ids).toContain("video:BV1xx411c7mD:iv:280001");
    expect(ids).toContain("video:BV1xx411c7mD:iv:100");
    expect(ids).toContain("video:BV1xx411c7mD:iv:200");
    expect(result.items.every((i) => i.interactive === true)).toBe(true);
    expect(result.items.every((i) => i.type === "video")).toBe(true);
  });

  it("普通视频不带 interactive 标记", async () => {
    const ctx: ParseContext = { http: httpWithJson(VIEW_MULTI_P) };
    const result = await new VideoParser().parse(ctx, "BV1xx411c7mD");
    expect(result.items[0]?.interactive).toBeUndefined();
  });

  it("充电专属置角标", async () => {
    const body = {
      code: 0,
      data: { ...VIEW_MULTI_P.data, is_upower_exclusive: true, pages: undefined },
    };
    const ctx: ParseContext = { http: httpWithJson(body) };
    const result = await new VideoParser().parse(ctx, "BV1xx411c7mD");
    expect(result.items[0]?.badge).toBe("充电专属");
  });

  it("av 号链接走 aid 查询", async () => {
    let seen = "";
    const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
      seen = String(input);
      return new Response(JSON.stringify(VIEW_MULTI_P), { status: 200 });
    };
    const ctx: ParseContext = { http: new HttpClient({ fetchImpl: fetchImpl as typeof fetch }) };
    await new VideoParser().parse(ctx, "https://www.bilibili.com/video/av170001");
    expect(seen).toContain("aid=170001");
  });

  it("接口业务错误映射为 BiliError(API_ERROR, apiCode=-404)", async () => {
    const ctx: ParseContext = {
      http: httpWithJson({ code: -404, message: "啥都木有", data: null }),
    };
    await expect(new VideoParser().parse(ctx, "BV1xx411c7mD")).rejects.toMatchObject({
      code: "API_ERROR",
      apiCode: -404,
    });
  });

  it("redirect_url 时返回跳转地址而非报错", async () => {
    const ctx: ParseContext = {
      http: httpWithJson({ code: 0, data: { redirect_url: "https://www.bilibili.com/bangumi/play/ss1" } }),
    };
    const result = await new VideoParser().parse(ctx, "BV1xx411c7mD");
    expect(result.redirectUrl).toBe("https://www.bilibili.com/bangumi/play/ss1");
    expect(result.items).toHaveLength(0);
  });

  it("非视频链接抛 INVALID_URL", async () => {
    const ctx: ParseContext = { http: httpWithJson(VIEW_MULTI_P) };
    await expect(new VideoParser().parse(ctx, "https://space.bilibili.com/123")).rejects.toMatchObject({
      code: "INVALID_URL",
    });
  });
});

describe("parseUrl 分发入口", () => {
  it("video 链接走 VideoParser", async () => {
    const ctx: ParseContext = { http: httpWithJson(VIEW_MULTI_P) };
    const result = await parseUrl(ctx, "https://www.bilibili.com/video/BV1xx411c7mD");
    expect(result.items.length).toBeGreaterThan(0);
  });

  it("未知类型抛 INVALID_URL", async () => {
    const ctx: ParseContext = { http: httpWithJson(VIEW_MULTI_P) };
    await expect(parseUrl(ctx, "https://example.com/x")).rejects.toBeInstanceOf(BiliError);
  });

  it("festival 活动页重定向到投稿视频并继续解析", async () => {
    const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      if (url.includes("/festival/2024")) {
        return new Response('<html><script>window.__INITIAL_STATE__ = {"videoInfo":{"bvid":"BV1xx411c7mD"}};</script></html>', { status: 200, headers: { "Content-Type": "text/html" } });
      }
      if (url.includes("/x/web-interface/view")) {
        return json(VIEW_MULTI_P);
      }
      return json({ code: -404, message: "not found", data: null });
    };
    const ctx: ParseContext = { http: new HttpClient({ fetchImpl: fetchImpl as typeof fetch }) };
    const result = await parseUrl(ctx, "https://www.bilibili.com/festival/2024");
    expect(result.type).toBe("video");
    expect(result.items).toHaveLength(2);
  });
});
