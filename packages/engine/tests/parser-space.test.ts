import { beforeEach, describe, expect, it } from "vitest";
import { HttpClient } from "../src/api/http.js";
import { resetWbiKeyCache } from "../src/media/wbi-keys.js";
import { BiliError } from "../src/errors.js";
import { SpaceParser, resetSpaceCache } from "../src/parser/space.js";
import { classifyUrl } from "../src/url.js";
import { parseUrl } from "../src/parser/index.js";
import type { ParseContext } from "../src/parser/types.js";

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function viewData(
  bvid: string,
  aid: number,
  cid: number,
  title: string,
  pages: Array<{ cid: number; page: number; part: string; duration: number }>,
) {
  return {
    code: 0,
    data: {
      bvid,
      aid,
      cid,
      title,
      pic: `http://i0.hdslb.com/${bvid}.jpg`,
      duration: 100,
      pubdate: 1600000000,
      desc: "desc",
      owner: { mid: 2, name: "测试UP", face: "http://i0.hdslb.com/face.jpg" },
      pages,
    },
  };
}

/** 返回一个能按 URL 路由 nav/arc/card/view 的 mock 客户端 */
function makeCtx(over: {
  vlist?: unknown[];
  uname?: string;
  arcKeywordCapture?: string[];
  cardCalls?: number[];
} = {}): ParseContext {
  const vlist = over.vlist ?? [];
  const viewByBvid: Record<string, unknown> = {
    BV1aa: viewData("BV1aa", 1001, 9001, "视频A", [{ cid: 9001, page: 1, part: "视频A", duration: 100 }]),
    BV2bb: viewData("BV2bb", 1002, 9002, "视频B", [
      { cid: 9101, page: 1, part: "P1 分集", duration: 30 },
      { cid: 9102, page: 2, part: "P2 分集", duration: 40 },
    ]),
    BV3cc: viewData("BV3cc", 1003, 9003, "视频C", [{ cid: 9003, page: 1, part: "视频C", duration: 60 }]),
    // BV4dd：view 失败（稿件已删除），应跳过该行
  };

  const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    if (url.includes("/x/web-interface/nav")) {
      return json({ code: 0, data: { wbi_img: { img_url: "https://i0.hdslb.com/bfs/wbi/aaa.png", sub_url: "https://i0.hdslb.com/bfs/wbi/bbb.png" } } });
    }
    if (url.includes("/x/space/wbi/arc/search")) {
      over.arcKeywordCapture?.push(url);
      return json({ code: 0, data: { list: { vlist }, page: { count: 1, pn: 1, ps: 40 } } });
    }
    if (url.includes("/x/web-interface/card")) {
      over.cardCalls?.push(1);
      return json({ code: 0, data: { card: { name: over.uname ?? "测试UP" } } });
    }
    if (url.includes("/x/web-interface/view")) {
      const bvid = new URL(url).searchParams.get("bvid");
      const body = bvid !== null ? viewByBvid[bvid] : undefined;
      if (body) return json(body);
      return json({ code: -404, message: "稿件不存在", data: null });
    }
    return json({ code: -404, message: "not found" });
  };
  return { http: new HttpClient({ fetchImpl: fetchImpl as typeof fetch }) };
}

const SAMPLE_VLIST = [
  { aid: 1001, bvid: "BV1aa", pic: "http://i0.hdslb.com/1.jpg", title: "视频A", created: 1600000000, length: "1:40" },
  { aid: 1002, bvid: "BV2bb", pic: "http://i0.hdslb.com/2.jpg", title: "视频B", created: 1600000001, length: "1:10", is_union_video: true },
  { aid: 1003, bvid: "BV3cc", pic: "http://i0.hdslb.com/3.jpg", title: "视频C", created: 1600000002, length: "1:00", is_charging_arc: true },
  { aid: 1004, bvid: "BV4dd", pic: "http://i0.hdslb.com/4.jpg", title: "视频D", created: 1600000003, length: "0:30" },
];

beforeEach(() => {
  resetWbiKeyCache();
  resetSpaceCache();
});

describe("classifyUrl space", () => {
  it("识别 UP 主页与 UP 站内搜索链接", () => {
    expect(classifyUrl("https://space.bilibili.com/2")).toEqual({ type: "space", token: "2" });
    expect(classifyUrl("https://space.bilibili.com/2/search/video?keyword=BV1aa")).toEqual({ type: "space", token: "2" });
    expect(classifyUrl("https://www.bilibili.com/medialist/play/12345")).toEqual({ type: "space", token: "12345" });
  });
});

describe("SpaceParser", () => {
  it("解析 UP 投稿列表：每条投稿按 view 平铺为分P 叶子，失败行跳过", async () => {
    const arcCapture: string[] = [];
    const cardCalls: number[] = [];
    const ctx = makeCtx({ vlist: SAMPLE_VLIST, arcKeywordCapture: arcCapture, cardCalls });

    const result = await new SpaceParser().parse(ctx, "https://space.bilibili.com/2");

    expect(arcCapture).toHaveLength(1);
    expect(arcCapture[0]).toContain("/x/space/wbi/arc/search");
    expect(arcCapture[0]).toContain("mid=2");
    expect(arcCapture[0]).toContain("ps=40");
    expect(arcCapture[0]).toContain("keyword="); // 无搜索词时传空串
    expect(cardCalls).toHaveLength(1);

    expect(result.type).toBe("space");
    expect(result.title).toBe("测试UP");
    // A(1P) + B(2P) + C(1P) = 4；D view 失败被跳过
    expect(result.items.map((i) => i.id)).toEqual([
      "video:BV1aa:p1",
      "video:BV2bb:p1",
      "video:BV2bb:p2",
      "video:BV3cc:p1",
    ]);

    const a = result.items.find((i) => i.bvid === "BV1aa");
    expect(a).toMatchObject({ aid: 1001, cid: 9001, page: 1, title: "视频A", groupTitle: "视频A", badge: "", url: "https://www.bilibili.com/video/BV1aa?p=1" });
    const b1 = result.items.find((i) => i.id === "video:BV2bb:p1");
    expect(b1).toMatchObject({ cid: 9101, page: 1, title: "P1 分集", groupTitle: "视频B", duration: 30, badge: "合作" });
    const b2 = result.items.find((i) => i.id === "video:BV2bb:p2");
    expect(b2).toMatchObject({ cid: 9102, page: 2, title: "P2 分集", badge: "合作" });
    const c = result.items.find((i) => i.bvid === "BV3cc");
    expect(c?.badge).toBe("充电专属");
    expect(result.items.find((i) => i.bvid === "BV4dd")).toBeUndefined();
  });

  it("UP 名按 mid 进程内缓存：同 mid 二次解析不再请求 card", async () => {
    const cardCalls: number[] = [];
    const ctx = makeCtx({ vlist: SAMPLE_VLIST, cardCalls });
    await new SpaceParser().parse(ctx, "https://space.bilibili.com/2");
    await new SpaceParser().parse(ctx, "https://space.bilibili.com/2");
    expect(cardCalls).toHaveLength(1);
  });

  it("带 keyword 的 UP 搜索链接：keyword 进入 arc 请求，标题带搜索词", async () => {
    const arcCapture: string[] = [];
    const ctx = makeCtx({ vlist: [SAMPLE_VLIST[0]], arcKeywordCapture: arcCapture });
    const result = await new SpaceParser().parse(ctx, "https://space.bilibili.com/2/search/video?keyword=BV1aa");
    expect(arcCapture[0]).toContain("keyword=BV1aa");
    expect(result.title).toBe("测试UP - 搜索“BV1aa”");
    expect(result.items).toHaveLength(1);
  });

  it("UP 无投稿（vlist 为空）返回空条目但保留标题", async () => {
    const ctx = makeCtx({ vlist: [] });
    const result = await new SpaceParser().parse(ctx, "https://space.bilibili.com/999");
    expect(result.title).toBe("测试UP");
    expect(result.items).toHaveLength(0);
  });

  it("pn 选项进入 arc 请求分页参数", async () => {
    const arcCapture: string[] = [];
    const ctx = makeCtx({ vlist: [], arcKeywordCapture: arcCapture });
    await new SpaceParser().parse(ctx, "https://space.bilibili.com/2", { pn: 3 });
    expect(arcCapture[0]).toContain("pn=3");
  });

  it("非 space 链接抛 INVALID_URL", async () => {
    const ctx = makeCtx();
    await expect(new SpaceParser().parse(ctx, "https://www.bilibili.com/video/BV1aa")).rejects.toMatchObject({ code: "INVALID_URL" });
    await expect(new SpaceParser().parse(ctx, "https://space.bilibili.com/abc")).rejects.toMatchObject({ code: "INVALID_URL" });
  });

  it("arc 接口业务错误映射为 BiliError(API_ERROR)", async () => {
    const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      if (url.includes("/x/web-interface/nav")) {
        return json({ code: 0, data: { wbi_img: { img_url: "https://i0.hdslb.com/bfs/wbi/aaa.png", sub_url: "https://i0.hdslb.com/bfs/wbi/bbb.png" } } });
      }
      if (url.includes("/x/space/wbi/arc/search")) {
        return json({ code: -352, message: "风控校验失败", data: null });
      }
      return json({ code: -404, message: "not found" });
    };
    const ctx: ParseContext = { http: new HttpClient({ fetchImpl: fetchImpl as typeof fetch }) };
    await expect(new SpaceParser().parse(ctx, "https://space.bilibili.com/2")).rejects.toMatchObject({ code: "API_ERROR", apiCode: -352 });
  });
});

describe("parseUrl 分发", () => {
  it("space 链接走 SpaceParser 并返回 space 类型结果", async () => {
    const ctx = makeCtx({ vlist: SAMPLE_VLIST });
    const result = await parseUrl(ctx, "https://space.bilibili.com/2");
    expect(result.type).toBe("space");
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0]).toMatchObject({ type: "video", bvid: "BV1aa" });
  });
});