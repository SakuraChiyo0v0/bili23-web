import { describe, expect, it } from "vitest";
import { HttpClient } from "../src/api/http.js";
import { VideoParser, buildSeasonItems } from "../src/parser/video.js";
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

  it("expandInteractiveNodes=false 时只回报 interactiveDetected，不展开分支节点", async () => {
    // 探测阶段不该碰 edgeinfo_v2：不该发生任何 BFS 请求
    const calls: string[] = [];
    const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/x/web-interface/nav")) {
        return json({ code: 0, data: { wbi_img: { img_url: "https://i0.hdslb.com/bfs/wbi/abc.png", sub_url: "https://i0.hdslb.com/bfs/wbi/def.png" } } });
      }
      if (url.includes("/x/web-interface/view")) {
        return json({ code: 0, data: { ...VIEW_MULTI_P.data, rights: { is_stein_gate: 1 }, pages: undefined } });
      }
      return json({ code: -404, message: "not found", data: null });
    };
    const ctx: ParseContext = { http: new HttpClient({ fetchImpl: fetchImpl as typeof fetch }) };
    const result = await new VideoParser().parse(ctx, "BV1xx411c7mD", { expandInteractiveNodes: false });
    expect(result.interactiveDetected).toBe(true);
    // 稿件本身仍是可下载条目（原版探测阶段列表为空，这里给 1 条更实用，见实现注释）
    expect(result.items).toHaveLength(1);
    expect(calls.some((u) => u.includes("/x/stein/edgeinfo_v2"))).toBe(false);
  });

  it("ignoreSeason=true 时忽略 ugc_season，只解析稿件自己的分P", async () => {
    const body = {
      code: 0,
      data: {
        bvid: "BV1AAA", aid: 1, cid: 100, title: "主稿件标题", pic: "main.jpg",
        duration: 10, pubdate: 1600000000, desc: "描述",
        owner: { mid: 1, name: "UP主", face: "" },
        pages: [
          { cid: 100, page: 1, part: "P1", duration: 10 },
          { cid: 101, page: 2, part: "P2", duration: 11 },
        ],
        ugc_season: {
          id: 9,
          title: "我的合集",
          sections: [
            { id: 1, title: "第一章", episodes: [{ aid: 9, bvid: "BV1ZZZ", cid: 900, title: "别人的稿件", arc: { pic: "z.jpg", pubdate: 1 } }] },
          ],
        },
      },
    };
    const ctx: ParseContext = { http: httpWithJson(body) };
    // 默认（不忽略合集）：展开整个合集（合集章节列表才是权威来源），标题取合集名
    const withSeason = await new VideoParser().parse(ctx, "https://www.bilibili.com/video/BV1AAA");
    expect(withSeason.title).toBe("我的合集");
    expect(withSeason.items.map((i) => i.id)).toEqual(["video:BV1ZZZ:p1"]);

    // ignoreSeason（= 原版 MultiPartListsDialog 里 del ugc_season 的那句）：只要本稿件的分P
    const partsOnly = await new VideoParser().parse(ctx, "https://www.bilibili.com/video/BV1AAA", { ignoreSeason: true });
    expect(partsOnly.title).toBe("主稿件标题");
    expect(partsOnly.items.map((i) => i.id)).toEqual(["video:BV1AAA:p1", "video:BV1AAA:p2"]);
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

describe("合集 ugc_season 展开（对齐桌面 episode/video.py:107-214）", () => {
  /** 两个章节：第一章里一个单P稿件 + 一个双P稿件，第二章里一个单P稿件 */
  function seasonBody(sections: unknown[] = [
    {
      id: 1, title: "第一章",
      episodes: [
        { aid: 1, bvid: "BV1AAA", cid: 100, title: "单P稿件", arc: { pic: "a.jpg", pubdate: 1600000000 } },
        {
          aid: 2, bvid: "BV1BBB", title: "多P稿件", arc: { pic: "b.jpg", pubdate: 1600000001 },
          pages: [{ cid: 201, page: 1, part: "上", duration: 5 }, { cid: 202, page: 2, part: "下", duration: 6 }],
        },
      ],
    },
    { id: 2, title: "第二章", episodes: [{ aid: 3, bvid: "BV1CCC", cid: 300, title: "另一个", arc: { pic: "c.jpg", pubdate: 1600000002 } }] },
  ]) {
    return {
      code: 0,
      data: {
        bvid: "BV1AAA", aid: 1, cid: 100, title: "主稿件标题", pic: "main.jpg",
        duration: 10, pubdate: 1600000000, desc: "描述",
        owner: { mid: 1, name: "UP主", face: "" },
        pages: [{ cid: 100, page: 1, part: "P1", duration: 10 }],
        ugc_season: { id: 9, title: "我的合集", sections },
      },
    };
  }

  it("属于合集时展开整个合集，结果标题取合集名", async () => {
    const ctx: ParseContext = { http: httpWithJson(seasonBody()) };
    const result = await new VideoParser().parse(ctx, "https://www.bilibili.com/video/BV1AAA");
    expect(result.title).toBe("我的合集");
    // 单P + 双P(2) + 单P = 4 个叶子
    expect(result.items.map((i) => i.id)).toEqual([
      "video:BV1AAA:p1", "video:BV1BBB:p1", "video:BV1BBB:p2", "video:BV1CCC:p1",
    ]);
  });

  it("多章节时给 section_title；合集名落 collection_title", async () => {
    const ctx: ParseContext = { http: httpWithJson(seasonBody()) };
    const result = await new VideoParser().parse(ctx, "https://www.bilibili.com/video/BV1AAA");
    const first = result.items[0]!;
    expect(first.collectionTitle).toBe("我的合集");
    expect(first.sectionTitle).toBe("第一章");
    expect(result.items[3]!.sectionTitle).toBe("第二章");
  });

  it("只有一个章节时不给 section_title（原版 `if section_count > 1`）", async () => {
    const one = [{ id: 1, title: "唯一章", episodes: [{ aid: 1, bvid: "BV1AAA", cid: 100, title: "只有一个", arc: { pic: "a.jpg", pubdate: 1 } }] }];
    const ctx: ParseContext = { http: httpWithJson(seasonBody(one)) };
    const result = await new VideoParser().parse(ctx, "https://www.bilibili.com/video/BV1AAA");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.sectionTitle).toBeUndefined();
    expect(result.items[0]!.collectionTitle).toBe("我的合集");
  });

  it("多P 稿件给出 parent_title（= containerTitle）与 partCount，单P 不给", async () => {
    const ctx: ParseContext = { http: httpWithJson(seasonBody()) };
    const result = await new VideoParser().parse(ctx, "https://www.bilibili.com/video/BV1AAA");
    const multi = result.items.filter((i) => i.bvid === "BV1BBB");
    expect(multi.map((i) => i.title)).toEqual(["上", "下"]);
    expect(multi.every((i) => i.containerTitle === "多P稿件")).toBe(true);
    expect(multi.every((i) => i.partCount === 2)).toBe(true);
    expect(result.items[0]!.containerTitle).toBeUndefined();
  });

  it("合集叶子带 containerType=list（→ 命名分类 COLLECTION，对应原版 COLLECTION_BIT）", async () => {
    const ctx: ParseContext = { http: httpWithJson(seasonBody()) };
    const result = await new VideoParser().parse(ctx, "https://www.bilibili.com/video/BV1AAA");
    expect(result.items.every((i) => i.containerType === "list")).toBe(true);
  });

  it("target 只认链接那个稿件：BV1BBB?p=2 → cid 202，而不是别的稿件的第 2 个分P", async () => {
    // 注意：真实接口会按请求的 bvid 回对应的 data.bvid，mock 必须照做 ——
    // 否则 ownBvid 永远是第一个稿件，窄化失效（我第一版就是这么写错的）
    const body = seasonBody();
    const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      const m = /bvid=([A-Za-z0-9]+)/.exec(url);
      const asked = m?.[1] ?? body.data.bvid;
      return new Response(JSON.stringify({ ...body, data: { ...body.data, bvid: asked } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const ctx: ParseContext = { http: new HttpClient({ fetchImpl: fetchImpl as typeof fetch }) };
    const result = await new VideoParser().parse(ctx, "https://www.bilibili.com/video/BV1BBB?p=2");
    expect(result.target).toEqual({ key: "cid", value: 202 });
  });

  it("没有 ugc_season 时仍走分P 展开（行为不变）", async () => {
    const ctx: ParseContext = { http: httpWithJson(VIEW_MULTI_P) };
    const result = await new VideoParser().parse(ctx, "https://www.bilibili.com/video/BV1xx411c7mD");
    expect(result.title).toBe("测试视频标题");
    expect(result.items).toHaveLength(2);
    expect(result.items[0]!.containerType).toBeUndefined();
  });

  it("onlyBvid（二次解析语义）：只保留指名的那一个稿件，不展开整个合集", () => {
    // 这条防的是：收藏夹里一个"属于某合集"的视频，解析时会顺带把整个合集都拉进来
    const data = seasonBody().data as NonNullable<Parameters<typeof buildSeasonItems>[0]>;
    const narrowed = buildSeasonItems(data, "BV1BBB");
    expect(narrowed.map((i) => i.id)).toEqual(["video:BV1BBB:p1", "video:BV1BBB:p2"]);
    // 但层级元数据仍然保留（原版收窄后仍挂在合集/章节节点下）
    expect(narrowed[0]!.collectionTitle).toBe("我的合集");
    expect(narrowed[0]!.sectionTitle).toBe("第一章");
  });
});

describe("链接指向项 target（对齐桌面 current_episode_data）", () => {  it("无 ?p= 时指向稿件默认 cid（= 第 1 个分P）", async () => {
    const ctx: ParseContext = { http: httpWithJson(VIEW_MULTI_P) };
    const result = await new VideoParser().parse(ctx, "https://www.bilibili.com/video/BV1xx411c7mD");
    expect(result.target).toEqual({ key: "cid", value: 280001 });
  });

  it("有 ?p=2 时指向第 2 个分P 的 cid", async () => {
    const ctx: ParseContext = { http: httpWithJson(VIEW_MULTI_P) };
    const result = await new VideoParser().parse(ctx, "https://www.bilibili.com/video/BV1xx411c7mD?p=2");
    expect(result.target).toEqual({ key: "cid", value: 280002 });
  });

  it("?p= 越界时退回默认 cid", async () => {
    const ctx: ParseContext = { http: httpWithJson(VIEW_MULTI_P) };
    const result = await new VideoParser().parse(ctx, "https://www.bilibili.com/video/BV1xx411c7mD?p=99");
    expect(result.target).toEqual({ key: "cid", value: 280001 });
  });

  it("单P 视频也带上 target", async () => {
    const body = { code: 0, data: { ...VIEW_MULTI_P.data, pages: undefined } };
    const ctx: ParseContext = { http: httpWithJson(body) };
    const result = await new VideoParser().parse(ctx, "BV1xx411c7mD");
    expect(result.target).toEqual({ key: "cid", value: 280001 });
  });

  it("链接指向项一定出现在 items 里（否则前端勾不中）", async () => {
    const ctx: ParseContext = { http: httpWithJson(VIEW_MULTI_P) };
    const result = await new VideoParser().parse(ctx, "https://www.bilibili.com/video/BV1xx411c7mD?p=2");
    const hit = result.items.find((it) => it.cid === result.target?.value);
    expect(hit?.id).toBe("video:BV1xx411c7mD:p2");
  });
});
