import { beforeEach, describe, expect, it } from "vitest";
import { HttpClient } from "../src/api/http.js";
import { resetWbiKeyCache } from "../src/media/wbi-keys.js";
import { BiliError } from "../src/errors.js";
import { WatchLaterParser } from "../src/parser/watch-later.js";
import { HistoryParser } from "../src/parser/history.js";
import { parseUrl } from "../src/parser/index.js";
import type { ParseContext } from "../src/parser/types.js";

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function viewData(bvid: string, aid: number, cid: number, title: string) {
  return { code: 0, data: { bvid, aid, cid, title, pic: "", duration: 100, pubdate: 1600000000, desc: "", owner: { mid: 1, name: "UP", face: "" }, pages: [{ cid, page: 1, part: title, duration: 100 }] } };
}

function makeCtx(over: {
  login?: boolean;
  toviewList?: unknown[];
  historyList?: unknown[];
  failNav?: boolean;
} = {}) {
  const urls: string[] = [];
  const viewByBvid: Record<string, unknown> = {
    BV1aa: viewData("BV1aa", 1, 9001, "看过视频A"),
    BV2bb: viewData("BV2bb", 2, 9002, "番剧视频B"),
  };
  const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/x/web-interface/nav")) {
      // 未登录/会话失效时 nav 仍下发 wbi_img（见 wbi-keys.ts 注释）
      return json({ code: over.failNav ? -101 : 0, data: { wbi_img: { img_url: "https://i0.hdslb.com/bfs/wbi/aaa.png", sub_url: "https://i0.hdslb.com/bfs/wbi/bbb.png" } } });
    }
    if (url.includes("/x/v2/history/toview/web")) {
      if (over.failNav) return json({ code: -101, message: "账号未登录" });
      return json({ code: 0, data: { list: over.toviewList ?? [] } });
    }
    if (url.includes("/x/web-interface/history/search")) {
      return json({ code: 0, data: { page: { total: 3 }, list: over.historyList ?? [] } });
    }
    if (url.includes("/x/web-interface/view")) {
      const bvid = new URL(url).searchParams.get("bvid");
      if (bvid && viewByBvid[bvid]) return json(viewByBvid[bvid]);
      return json({ code: -404, message: "稿件不存在" });
    }
    return json({ code: -404, message: "not found" });
  };
  const http = new HttpClient({ fetchImpl: fetchImpl as typeof fetch });
  if (over.login) http.jar.set("SESSDATA", "mock-sess");
  return { http, urls };
}

beforeEach(() => resetWbiKeyCache());

const TOVIEW_LIST = [
  { aid: 1, bvid: "BV1aa", cid: 9001, pic: "", title: "稍后看A", pubdate: 1600000000, add_at: 1600000001, duration: 100 },
  { aid: 2, bvid: "BV2bb", cid: 9002, pic: "", title: "番剧一集", pubdate: 1600000000, add_at: 1600000002, duration: 100, pgc_label: "番剧", bangumi: { ep_id: 5001 } },
];

const HISTORY_LIST = [
  { history: { bvid: "BV1aa", cid: 9001, epid: 0, business: "archive" }, title: "看过A", cover: "", duration: 100, badge: "", view_at: 1600000000, uri: "" },
  { history: { bvid: "BV9pg", cid: 9999, epid: 0, business: "pgc" }, title: "某番", cover: "", duration: 100, badge: "", view_at: 1600000000, uri: "" },
];

describe("WatchLaterParser（稍后再看，需登录）", () => {
  it("匿名调用：前置抛 LOGIN_REQUIRED 且不发任何请求", async () => {
    let called = false;
    const fetchImpl = async (): Promise<Response> => {
      called = true;
      return new Response("{}", { status: 500 });
    };
    const ctx: ParseContext = { http: new HttpClient({ fetchImpl: fetchImpl as typeof fetch }) };
    await expect(new WatchLaterParser().parse(ctx, "bili23://watch_later")).rejects.toMatchObject({ code: "LOGIN_REQUIRED" });
    expect(called).toBe(false);
  });

  it("带 SESSDATA：archive 行平铺为视频叶子，bangumi 行映射为单集番剧叶子", async () => {
    const ctx = makeCtx({ login: true, toviewList: TOVIEW_LIST });
    const result = await new WatchLaterParser().parse({ http: ctx.http }, "bili23://watch_later");
    const req = ctx.urls.find((u) => u.includes("/x/v2/history/toview/web"));
    expect(req).toContain("ps=20");
    expect(req).toContain("viewed=0");
    expect(result.items).toHaveLength(2);
    const videoLeaf = result.items.find((i) => i.bvid === "BV1aa");
    expect(videoLeaf).toMatchObject({ type: "video", cid: 9001 });
    const bgLeaf = result.items.find((i) => i.type === "bangumi");
    expect(bgLeaf).toMatchObject({ bvid: "BV2bb", cid: 9002, epId: 5001, badge: "番剧" });
  });

  it("key 搜索参数随链接进入请求，标题带关键词", async () => {
    const ctx = makeCtx({ login: true, toviewList: TOVIEW_LIST });
    const result = await new WatchLaterParser().parse({ http: ctx.http }, "bili23://watch_later?key=BV1aa");
    const req = ctx.urls.find((u) => u.includes("/x/v2/history/toview/web"));
    expect(req).toContain("key=BV1aa");
    expect(result.title).toBe("搜索“BV1aa”");
  });

  it("会话失效（code=-101）映射为 LOGIN_REQUIRED", async () => {
    const ctx = makeCtx({ login: true, failNav: true });
    await expect(new WatchLaterParser().parse({ http: ctx.http }, "bili23://watch_later")).rejects.toMatchObject({ code: "LOGIN_REQUIRED" });
  });
});

describe("HistoryParser（观看历史，需登录）", () => {
  it("匿名调用：前置抛 LOGIN_REQUIRED 且不发任何请求", async () => {
    let called = false;
    const fetchImpl = async (): Promise<Response> => {
      called = true;
      return new Response("{}", { status: 500 });
    };
    const ctx: ParseContext = { http: new HttpClient({ fetchImpl: fetchImpl as typeof fetch }) };
    await expect(new HistoryParser().parse(ctx, "bili23://history")).rejects.toMatchObject({ code: "LOGIN_REQUIRED" });
    expect(called).toBe(false);
  });

  it("带 SESSDATA：只展开 archive 行，pgc 行忽略", async () => {
    const ctx = makeCtx({ login: true, historyList: HISTORY_LIST });
    const result = await new HistoryParser().parse({ http: ctx.http }, "bili23://history");
    const req = ctx.urls.find((u) => u.includes("/x/web-interface/history/search"));
    expect(req).toContain("business=archive");
    expect(req).toContain("ps=20");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ bvid: "BV1aa", type: "video" });
  });
});

describe("parseUrl 分发需登录类型", () => {
  it("bili23://watch_later / history 路由到对应解析器", async () => {
    const ctx = makeCtx({ login: true, toviewList: [], historyList: [] });
    const wl = await parseUrl({ http: ctx.http }, "bili23://watch_later");
    expect(wl.type).toBe("watch_later");
    const h = await parseUrl({ http: ctx.http }, "bili23://history");
    expect(h.type).toBe("history");
  });
});