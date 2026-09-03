import { beforeEach, describe, expect, it } from "vitest";
import { HttpClient } from "../src/api/http.js";
import { resetWbiKeyCache } from "../src/media/wbi-keys.js";
import type { ParseContext } from "../src/parser/types.js";
import {
  coverDownloadUrl,
  fetchCoverBytes,
  fetchDanmakuXml,
  fetchPlayerInfo,
  fetchSubtitleJson,
  fetchSubtitlesData,
  fetchVideoTags,
  filterSubtitleInfos,
  resolveSubtitleUrl,
} from "../src/extras/fetch.js";

const NAV = {
  code: 0,
  data: {
    wbi_img: {
      img_url: "https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png",
      sub_url: "https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png",
    },
  },
};

const PLAYER_OK = {
  code: 0,
  data: {
    subtitle: {
      subtitles: [
        { lan: "zh", lan_doc: "中文（简体）", subtitle_url: "//aisubtitle.hdslb.com/bfs/ai_subtitle/1.json" },
        { lan: "ai-zh", lan_doc: "中文", subtitle_url: "//aisubtitle.hdslb.com/bfs/ai_subtitle/2.json" },
      ],
    },
    view_points: [
      { id: 1, from: 0, to: 100, content: "Intro" },
      { id: 2, from: 100, to: 200, content: "Main" },
    ],
  },
};

const SUB_JSON = { font_size: 0.4, body: [{ from: 1, to: 2, content: "hi" }] };

let lastUrl = "";
let mode: "ok" | "login" | "api-error" = "ok";
let coverAttempts = 0;

function makeCtx(): ParseContext {
  lastUrl = "";
  coverAttempts = 0;
  const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    lastUrl = url;
    if (url.includes("/x/web-interface/nav")) {
      return new Response(JSON.stringify(NAV), { status: 200 });
    }
    if (url.includes("/x/player/wbi/v2")) {
      if (mode === "login") {
        return new Response(JSON.stringify({ code: -101, message: "账号未登录" }), { status: 200 });
      }
      if (mode === "api-error") {
        return new Response(JSON.stringify({ code: -400, message: "请求错误" }), { status: 200 });
      }
      return new Response(JSON.stringify(PLAYER_OK), { status: 200 });
    }
    if (url.includes("/x/v1/dm/list.so") || url.includes("comment.bilibili.com")) {
      return new Response("<?xml version=\"1.0\"?><i><d p=\"1.00,1,25,16777215,0,0,a,1\">x</d></i>", {
        status: 200,
        headers: { "Content-Type": "application/xml" },
      });
    }
    if (url.startsWith("https://aisubtitle.hdslb.com/")) {
      return new Response(JSON.stringify(SUB_JSON), { status: 200 });
    }
    if (url.includes("@.jpg")) {
      coverAttempts += 1;
      if (coverAttempts < 3) {
        return new Response("nope", { status: 404 });
      }
      return new Response("JPGDATA", { status: 200 });
    }
    if (url.includes("/x/web-interface/view/detail/tag")) {
      return new Response(
        JSON.stringify({ code: 0, data: [{ tag_name: "a" }, { tag_name: "b" }] }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ code: -404, message: "not found" }), { status: 200 });
  };
  return { http: new HttpClient({ fetchImpl: fetchImpl as typeof fetch }) };
}

const ITEM = { bvid: "BV1xx411c7mD", aid: 10239235, cid: 137649199 };

describe("extras/fetch", () => {
  beforeEach(() => {
    mode = "ok";
    resetWbiKeyCache();
  });

  it("fetchDanmakuXml：请求 comment.bilibili.com/{cid}.xml 并返回 XML 文本", async () => {
    const xml = await fetchDanmakuXml(makeCtx(), 137649199);
    expect(lastUrl).toBe("https://comment.bilibili.com/137649199.xml");
    expect(xml).toContain("<d p=");
  });

  it("fetchPlayerInfo：x/player/wbi/v2 WBI 签名请求，返回字幕+章节", async () => {
    const ctx = makeCtx();
    const info = await fetchPlayerInfo(ctx, ITEM);
    expect(lastUrl).toContain("/x/player/wbi/v2?");
    expect(lastUrl).toContain("cid=137649199");
    expect(lastUrl).toContain("bvid=BV1xx411c7mD");
    expect(lastUrl).toContain("wts=");
    expect(lastUrl).toContain("w_rid=");
    expect(lastUrl).toContain("dm_img_str=");
    expect(info.subtitle?.subtitles).toHaveLength(2);
    expect(info.view_points).toHaveLength(2);
  });

  it("fetchPlayerInfo：aid 条目不带 bvid 时用 aid", async () => {
    const ctx = makeCtx();
    await fetchPlayerInfo(ctx, { aid: 10239235, cid: 1 });
    expect(lastUrl).toContain("aid=10239235");
    expect(lastUrl).not.toContain("bvid=");
  });

  it("fetchPlayerInfo：无 bvid/aid 抛 INVALID_URL", async () => {
    await expect(fetchPlayerInfo(makeCtx(), { cid: 1 })).rejects.toMatchObject({
      code: "INVALID_URL",
    });
  });

  it("fetchPlayerInfo：-101 登录错误映射 LOGIN_REQUIRED", async () => {
    mode = "login";
    await expect(fetchPlayerInfo(makeCtx(), ITEM)).rejects.toMatchObject({
      code: "LOGIN_REQUIRED",
      apiCode: -101,
    });
  });

  it("fetchPlayerInfo：其他业务码映射 API_ERROR", async () => {
    mode = "api-error";
    await expect(fetchPlayerInfo(makeCtx(), ITEM)).rejects.toMatchObject({
      code: "API_ERROR",
      apiCode: -400,
    });
  });

  it("resolveSubtitleUrl / fetchSubtitleJson：// 前缀补 https:", async () => {
    expect(resolveSubtitleUrl("//aisubtitle.hdslb.com/1.json")).toBe("https://aisubtitle.hdslb.com/1.json");
    expect(resolveSubtitleUrl("https://x/y.json")).toBe("https://x/y.json");
    const data = await fetchSubtitleJson(makeCtx(), {
      lan: "zh",
      subtitleUrl: "//aisubtitle.hdslb.com/bfs/ai_subtitle/1.json",
    });
    expect(lastUrl).toBe("https://aisubtitle.hdslb.com/bfs/ai_subtitle/1.json");
    expect(data.body?.[0]?.content).toBe("hi");
  });

  it("coverDownloadUrl / fetchCoverBytes：@{format} 后缀，HTTP 错误整体重试 3 次", async () => {
    expect(coverDownloadUrl("https://i0.hdslb.com/bfs/cover.jpg", "webp")).toBe(
      "https://i0.hdslb.com/bfs/cover.jpg@.webp",
    );
    const bytes = await fetchCoverBytes(makeCtx(), "https://i0.hdslb.com/bfs/cover.jpg", "jpg");
    expect(lastUrl).toContain("@.jpg");
    expect(coverAttempts).toBe(3);
    expect(new TextDecoder().decode(bytes)).toBe("JPGDATA");
  });

  it("fetchVideoTags：返回 tag_name 列表；接口错误返回空数组", async () => {
    const tags = await fetchVideoTags(makeCtx(), "BV1xx411c7mD");
    expect(lastUrl).toContain("/x/web-interface/view/detail/tag?bvid=BV1xx411c7mD");
    expect(tags).toEqual(["a", "b"]);
  });
});

describe("subtitle 语言选择", () => {
  it("filterSubtitleInfos：指定语言时只保留命中的 lan", () => {
    const list = [
      { lan: "zh", lanDoc: "中文", subtitleUrl: "//x/1.json" },
      { lan: "ai-zh", lanDoc: "中文", subtitleUrl: "//x/2.json" },
      { lan: "en", lanDoc: "英语", subtitleUrl: "//x/3.json" },
    ];
    const all = filterSubtitleInfos(list, { downloadSpecified: false, specifiedLanguages: [] });
    expect(all).toHaveLength(3);
    const zh = filterSubtitleInfos(list, { downloadSpecified: true, specifiedLanguages: ["zh"] });
    expect(zh.map((e) => e.lan)).toEqual(["zh"]);
    expect(filterSubtitleInfos(list, { downloadSpecified: true, specifiedLanguages: ["zh", "en"] })).toHaveLength(2);
  });

  it("fetchSubtitlesData：逐条下载并组装 language/languageDoc/data", async () => {
    const ctx = makeCtx();
    const list = [
      { lan: "zh", lanDoc: "中文（简体）", subtitleUrl: "//aisubtitle.hdslb.com/bfs/ai_subtitle/1.json" },
      { lan: "en", lanDoc: "英语", subtitleUrl: "//aisubtitle.hdslb.com/bfs/ai_subtitle/nope.json" },
    ];
    const data = await fetchSubtitlesData(ctx, list, { downloadSpecified: true, specifiedLanguages: ["zh"] });
    expect(data).toHaveLength(1);
    expect(data[0]?.language).toBe("zh");
    expect(data[0]?.languageDoc).toBe("中文（简体）");
    expect(data[0]?.data.body?.[0]?.content).toBe("hi");
  });
});
