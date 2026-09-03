import { beforeEach, describe, expect, it } from "vitest";
import { HttpClient } from "../src/api/http.js";
import { BiliError } from "../src/errors.js";
import { AudioParser } from "../src/parser/audio.js";
import type { ParseContext } from "../src/parser/types.js";

/** 歌单内一首歌（of-menu 列表项，statistic.sid 为下载用 sid） */
const MENU_SONG = {
  id: 13526,
  uid: 282994,
  uname: "泠鸢yousa",
  author: "泠鸢",
  title: "unravel（东京食尸鬼）",
  cover: "http://i0.hdslb.com/bfs/music/cover.jpg",
  intro: "翻唱",
  duration: 240,
  passtime: 1501640768,
  statistic: { sid: 13526 },
};

const MENU_LIST = {
  code: 0,
  message: "OK",
  data: {
    curPage: 1,
    pageCount: 1,
    totalSize: 1,
    pageSize: 1,
    data: [MENU_SONG],
  },
};

const MENU_INFO = {
  code: 0,
  message: "OK",
  data: { menuId: 26241, uid: 32708543, title: "那些听了会泪目的动漫歌曲", cover: "" },
};

const SONG_INFO = {
  code: 0,
  message: "OK",
  data: { ...MENU_SONG, statistic: { sid: 13526 } },
};

let calls: string[] = [];

function makeCtx(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>): ParseContext {
  return { http: new HttpClient({ fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => fetchImpl(String(input), init)) as typeof fetch }) };
}

function defaultFetch(url: string, _init?: RequestInit): Promise<Response> {
  calls.push(url);
  if (url.includes("/menu/info")) return Promise.resolve(new Response(JSON.stringify(MENU_INFO), { status: 200 }));
  if (url.includes("/song/of-menu")) return Promise.resolve(new Response(JSON.stringify(MENU_LIST), { status: 200 }));
  if (url.includes("/song/info")) return Promise.resolve(new Response(JSON.stringify(SONG_INFO), { status: 200 }));
  return Promise.resolve(new Response(JSON.stringify({ code: -404, message: "not found" }), { status: 200 }));
}

describe("AudioParser", () => {
  beforeEach(() => {
    calls = [];
  });

  it("am 歌单链接：先 menu/info 取标题，再 of-menu 取歌曲列表，条目带 sid/auId", async () => {
    const result = await new AudioParser().parse(makeCtx(defaultFetch), "https://www.bilibili.com/audio/am26241");
    expect(calls.some((u) => u.includes("/menu/info?sid=26241"))).toBe(true);
    expect(calls.some((u) => u.includes("/song/of-menu?sid=26241&pn=1&ps=100"))).toBe(true);
    expect(calls.some((u) => u.includes("/song/info"))).toBe(false);
    expect(result.type).toBe("audio");
    expect(result.title).toBe("那些听了会泪目的动漫歌曲");
    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    expect(item).toMatchObject({
      id: "audio:au13526",
      type: "audio",
      auId: 13526,
      sid: 13526,
      page: 1,
      title: "unravel（东京食尸鬼）",
      groupTitle: "那些听了会泪目的动漫歌曲",
      duration: 240,
      pubtime: 1501640768,
      owner: { mid: 282994, name: "泠鸢", face: "" },
      url: "https://www.bilibili.com/audio/au13526",
    });
  });

  it("au 单曲链接：只请求 song/info，单曲即容器（groupTitle=标题）", async () => {
    const result = await new AudioParser().parse(makeCtx(defaultFetch), "https://www.bilibili.com/audio/au13526");
    expect(calls.some((u) => u.includes("/song/info?sid=13526"))).toBe(true);
    expect(calls.some((u) => u.includes("/menu/info") || u.includes("/of-menu"))).toBe(false);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.sid).toBe(13526);
    expect(result.items[0]?.groupTitle).toBe("unravel（东京食尸鬼）");
  });

  it("无 statistic.sid 时回落条目 id 作为 sid", async () => {
    const body = { code: 0, message: "OK", data: { ...MENU_SONG, statistic: undefined } };
    const result = await new AudioParser().parse(
      makeCtx(async (url) => {
        calls.push(url);
        return new Response(JSON.stringify(url.includes("/song/info") ? body : { code: -1, message: "x" }), { status: 200 });
      }),
      "au13526",
    );
    expect(result.items[0]?.sid).toBe(13526);
  });

  it("接口业务错误映射 API_ERROR", async () => {
    const ctx = makeCtx(async (url) => {
      calls.push(url);
      return new Response(JSON.stringify({ code: 4511001, message: "音频不存在" }), { status: 200 });
    });
    await expect(new AudioParser().parse(ctx, "https://www.bilibili.com/audio/au99999")).rejects.toMatchObject({
      code: "API_ERROR",
      apiCode: 4511001,
    });
  });

  it("歌单没有歌曲时抛 API_ERROR", async () => {
    const ctx = makeCtx(async (url) => {
      calls.push(url);
      if (url.includes("/menu/info")) return new Response(JSON.stringify(MENU_INFO), { status: 200 });
      return new Response(JSON.stringify({ code: 0, data: { data: [] } }), { status: 200 });
    });
    await expect(new AudioParser().parse(ctx, "am26241")).rejects.toMatchObject({ code: "API_ERROR" });
  });

  it("非音乐链接抛 INVALID_URL", async () => {
    await expect(new AudioParser().parse(makeCtx(defaultFetch), "https://www.bilibili.com/video/BV1xx411c7mD")).rejects.toMatchObject({
      code: "INVALID_URL",
    });
  });

});
