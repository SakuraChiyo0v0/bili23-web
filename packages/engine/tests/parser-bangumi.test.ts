import { describe, expect, it } from "vitest";
import { HttpClient } from "../src/api/http.js";
import { BiliError } from "../src/errors.js";
import { BangumiParser } from "../src/parser/bangumi.js";
import { classifyUrl } from "../src/url.js";
import type { ParseContext } from "../src/parser/types.js";

function makeSeasonResult() {
  return {
    season_id: 28861,
    media_id: 29508,
    season_title: "测试番剧 第一季",
    type: 1,
    cover: "https://i0.hdslb.com/bfs/bangumi/cover.jpg",
    evaluate: "简介",
    up_info: { mid: 123, uname: "UP主", avatar: "https://i0.hdslb.com/face.jpg" },
    series: { series_id: 2, series_title: "系列总标题" },
    seasons: [{ season_id: 28861, season_title: "第一季" }, { season_id: 28862, season_title: "第二季" }],
    episodes: [
      { ep_id: 399341, aid: 10239235, cid: 280001, bvid: "BV1xx411c7mD", badge: "", cover: "", duration: 1493000, pub_time: 1620000000, title: "第一话完整标题", show_title: "第1话", link: "https://www.bilibili.com/bangumi/play/ep399341" },
      { ep_id: 399342, aid: 10239236, cid: 280002, bvid: "BV1xx411c7mE", badge: "预告", cover: "", duration: 90000, pub_time: 1620000001, title: "预告", link: "https://www.bilibili.com/bangumi/play/ep399342" },
    ],
    section: [
      {
        title: "特别篇",
        episodes: [
          { ep_id: 499001, aid: 20239235, cid: 330001, bvid: "BV1yy411c7mD", badge: "", cover: "", duration: 1200000, pub_time: 1620000002, title: "番外 标题", link: "https://www.bilibili.com/bangumi/play/ep499001" },
        ],
      },
      {
        title: "UP主陪你看",
        episodes: [{ ep_id: 599001, badge: "", duration: 1200000, title: "无 bvid/cid 章节" }],
      },
    ],
  };
}

let lastUrl = "";
let seasonBody: unknown = makeSeasonResult();
let reviewSeasonId = 28861;

function makeCtx(): ParseContext {
  lastUrl = "";
  seasonBody = makeSeasonResult();
  reviewSeasonId = 28861;
  const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    lastUrl = url;
    if (url.includes("/pgc/review/user")) {
      return new Response(JSON.stringify({ code: 0, result: { media: { season_id: reviewSeasonId } } }), { status: 200 });
    }
    if (url.includes("/pgc/view/web/season")) {
      return new Response(JSON.stringify({ code: 0, result: seasonBody }), { status: 200 });
    }
    return new Response(JSON.stringify({ code: -404, message: "not found" }), { status: 200 });
  };
  return { http: new HttpClient({ fetchImpl: fetchImpl as typeof fetch }) };
}

describe("classifyUrl bangumi", () => {
  it("识别 ss/ep/md 链接", () => {
    expect(classifyUrl("https://www.bilibili.com/bangumi/play/ss28861")).toEqual({ type: "bangumi", token: "ss28861" });
    expect(classifyUrl("https://www.bilibili.com/bangumi/play/ep399341")).toEqual({ type: "bangumi", token: "ep399341" });
    expect(classifyUrl("https://www.bilibili.com/bangumi/media/md29508")).toEqual({ type: "bangumi", token: "md29508" });
  });
});

describe("BangumiParser", () => {
  it("ss 链接：请求 season 接口并平铺正片+特别篇，剔除无 bvid/cid 章节", async () => {
    const result = await new BangumiParser().parse(makeCtx(), "https://www.bilibili.com/bangumi/play/ss28861");
    expect(lastUrl).toContain("/pgc/view/web/season?season_id=28861");
    expect(result.type).toBe("bangumi");
    expect(result.title).toBe("测试番剧 第一季");
    const items = result.items;
    expect(items).toHaveLength(3); // 正片2（含预告） + 特别篇1
    const ep1 = items.find((i) => i.epId === 399341);
    expect(ep1?.bvid).toBe("BV1xx411c7mD");
    expect(ep1?.cid).toBe(280001);
    expect(ep1?.aid).toBe(10239235);
    expect(ep1?.title).toBe("第1话"); // show_title 优先
    expect(ep1?.groupTitle).toBe("测试番剧 第一季");
    expect(ep1?.duration).toBe(1493); // 毫秒 → 秒
    expect(ep1?.page).toBe(1); // 非预告序号
    expect(ep1?.badge).toBe("");
    expect(ep1?.owner.name).toBe("UP主");
    expect(ep1?.type).toBe("bangumi");
    const trailer = items.find((i) => i.epId === 399342);
    expect(trailer?.badge).toBe("预告");
    const special = items.find((i) => i.epId === 499001);
    expect(special?.title).toBe("番外 标题");
    expect(items.find((i) => i.epId === 599001)).toBeUndefined();
  });

  it("ep 链接：以 ep_id 拉 season，返回完整季列表", async () => {
    const result = await new BangumiParser().parse(makeCtx(), "https://www.bilibili.com/bangumi/play/ep399341");
    expect(lastUrl).toContain("/pgc/view/web/season?ep_id=399341");
    expect(result.items.length).toBeGreaterThan(0);
  });

  it("md 链接：先经 pgc/review/user 换 season_id 再拉 season", async () => {
    const result = await new BangumiParser().parse(makeCtx(), "https://www.bilibili.com/bangumi/media/md29508");
    expect(lastUrl).toContain("/pgc/view/web/season?season_id=28861");
    expect(result.items.length).toBeGreaterThan(0);
  });

  it("season 接口业务错误映射 API_ERROR", async () => {
    seasonBody = undefined;
    const ctx = makeCtx();
    ctx.http = new HttpClient({
      fetchImpl: (async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/pgc/view/web/season")) {
          return new Response(JSON.stringify({ code: -404, message: "稿件不存在" }), { status: 200 });
        }
        return new Response(JSON.stringify({ code: -404, message: "not found" }), { status: 200 });
      }) as typeof fetch,
    });
    await expect(new BangumiParser().parse(ctx, "https://www.bilibili.com/bangumi/play/ss999999")).rejects.toBeInstanceOf(BiliError);
  });

  it("非 bangumi 链接报 INVALID_URL", async () => {
    await expect(new BangumiParser().parse(makeCtx(), "https://www.bilibili.com/video/BV1xx411c7mD")).rejects.toMatchObject({ code: "INVALID_URL" });
  });
});
