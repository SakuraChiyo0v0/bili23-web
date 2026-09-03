import { beforeEach, describe, expect, it } from "vitest";
import { HttpClient } from "../src/api/http.js";
import { BiliError } from "../src/errors.js";
import { fetchPlayMediaInfo, flavorOf } from "../src/media/flavor.js";
import { resetWbiKeyCache } from "../src/media/wbi-keys.js";
import type { ParseContext } from "../src/parser/types.js";
import type { MediaItem } from "../src/types.js";

const PGC_DASH_RESULT = {
  code: 0,
  result: {
    timelength: 213000,
    accept_quality: [127, 126, 120, 80, 64],
    accept_description: ["8K", "杜比视界", "4K", "1080P", "720P"],
    dash: {
      video: [
        { id: 127, codecid: 13, baseUrl: "https://up/v127-av1.m4s", codecs: "av01.0.05M.08", bandwidth: 8000000, mimeType: "video/mp4" },
        { id: 80, codecid: 7, baseUrl: "https://up/v80-avc.m4s", codecs: "avc1.640028", bandwidth: 2000000, mimeType: "video/mp4" },
        { id: 64, codecid: 7, baseUrl: "https://up/v64-avc.m4s", backupUrl: ["https://up2/v64-avc.m4s"], codecs: "avc1.4d401f", bandwidth: 900000, mimeType: "video/mp4" },
      ],
      audio: [
        { id: 30280, codecid: 0, baseUrl: "https://up/a192.m4s", bandwidth: 192000, mimeType: "audio/mp4" },
        { id: 30216, codecid: 0, baseUrl: "https://up/a64.m4s", bandwidth: 64000, mimeType: "audio/mp4" },
      ],
    },
  },
};

const PGC_MP4_RESULT = {
  code: 0,
  result: {
    timelength: 60000,
    format: "mp4",
    accept_quality: [64, 32],
    accept_description: ["720P", "480P"],
    durl: [{ order: 1, url: "https://up/ep1.mp4", size: 1000, length: 60000 }],
  },
};

/** pugv（课堂课程）端点返回 snake_case 流字段（桌面 query_worker 兼容 baseUrl/base_url 两种命名） */
const PUGV_SNAKE_RESULT = {
  code: 0,
  result: {
    timelength: 209000,
    format: "flv",
    accept_quality: [80, 64, 32, 16],
    accept_description: ["1080P", "720P", "480P", "360P"],
    dash: {
      video: [
        { id: 64, codecid: 7, base_url: "https://up/pugv-v64.m4s", backup_url: ["https://up2/pugv-v64.m4s"], codecs: "avc1.4d401f", bandwidth: 900000, mime_type: "video/mp4", width: 1280, height: 720 },
        { id: 16, codecid: 7, base_url: "https://up/pugv-v16.m4s", codecs: "avc1.42c01e", bandwidth: 200000, mime_type: "video/mp4", width: 640, height: 360 },
      ],
      audio: [
        { id: 30216, codecid: 0, base_url: "https://up/pugv-a64.m4s", backup_url: ["https://up2/pugv-a64.m4s"], bandwidth: 64000, mime_type: "audio/mp4" },
      ],
    },
  },
};

const NAV_BODY = {
  code: 0,
  data: { wbi_img: { img_url: "https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png", sub_url: "https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png" } },
};

let navCount = 0;
let lastUrl = "";
let mode: "pgc-dash" | "pgc-mp4" | "pugv" | "pugv-snake" | "pgc-login" = "pgc-dash";

function makeCtx(): ParseContext {
  navCount = 0;
  lastUrl = "";
  const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    if (url.includes("/x/web-interface/nav")) {
      navCount += 1;
      return new Response(JSON.stringify(NAV_BODY), { status: 200 });
    }
    if (url.includes("/pgc/player/web/playurl")) {
      lastUrl = url;
      if (mode === "pgc-mp4") return new Response(JSON.stringify(PGC_MP4_RESULT), { status: 200 });
      if (mode === "pgc-login") return new Response(JSON.stringify({ code: -10403, message: "抱歉，您所在地区不可观看" }), { status: 200 });
      return new Response(JSON.stringify(PGC_DASH_RESULT), { status: 200 });
    }
    if (url.includes("/x/player/wbi/playurl")) {
      lastUrl = url;
      return new Response(JSON.stringify({ code: 0, data: PGC_DASH_RESULT.result }), { status: 200 });
    }
    if (url.includes("/pugv/player/web/playurl")) {
      lastUrl = url;
      if (mode === "pugv-snake") return new Response(JSON.stringify(PUGV_SNAKE_RESULT), { status: 200 });
      return new Response(JSON.stringify(PGC_DASH_RESULT), { status: 200 });
    }
    return new Response(JSON.stringify({ code: -404, message: "not found" }), { status: 200 });
  };
  return { http: new HttpClient({ fetchImpl: fetchImpl as typeof fetch }) };
}

const BANGUMI_ITEM: MediaItem = {
  id: "bangumi:BV1xx:p1",
  type: "bangumi",
  aid: 10239235,
  bvid: "BV1xx411c7mD",
  cid: 280001,
  epId: 399341,
  page: 1,
  title: "第1话",
  groupTitle: "测试番剧",
  duration: 213,
  badge: "",
  cover: "https://i0.hdslb.com/bfs/archive/cover.jpg",
  pubtime: 0,
  owner: { mid: 0, name: "", face: "" },
  desc: "",
  url: "https://www.bilibili.com/bangumi/play/ep399341",
};

const CHEESE_ITEM: MediaItem = {
  id: "cheese:BV1xx:p1",
  type: "cheese",
  aid: 10239235,
  bvid: "BV1xx411c7mD",
  cid: 280001,
  epId: 45,
  page: 1,
  title: "课时1",
  groupTitle: "测试课程",
  duration: 213,
  badge: "",
  cover: "",
  pubtime: 0,
  owner: { mid: 0, name: "", face: "" },
  desc: "",
  url: "https://www.bilibili.com/cheese/play/ep45",
};

beforeEach(() => {
  resetWbiKeyCache();
  mode = "pgc-dash";
});

describe("flavorOf", () => {
  it("按条目类型映射取流端点：video→www / bangumi→pgc / cheese→pugv / audio→audio / lesson→lesson", () => {
    expect(flavorOf({ type: "video" })).toBe("www");
    expect(flavorOf({ type: "bangumi" })).toBe("pgc");
    expect(flavorOf({ type: "cheese" })).toBe("pugv");
    expect(flavorOf({ type: "audio" })).toBe("audio");
    expect(flavorOf({ type: "lesson" })).toBe("lesson");
  });
});

describe("fetchPlayMediaInfo（PGC/PUGV 分发）", () => {
  it("bangumi：请求 pgc/player/web/playurl，明文参数 fnval=143312，无 wbi 签名，不访问 nav", async () => {
    const info = await fetchPlayMediaInfo(makeCtx(), BANGUMI_ITEM);
    expect(lastUrl).toContain("/pgc/player/web/playurl");
    expect(lastUrl).toContain("fnval=143312");
    expect(lastUrl).toContain("fourk=1");
    expect(lastUrl).toContain("bvid=BV1xx411c7mD");
    expect(lastUrl).toContain("cid=280001");
    expect(lastUrl).not.toContain("wts=");
    expect(lastUrl).not.toContain("w_rid=");
    expect(navCount).toBe(0);
    expect(info.mediaType).toBe("dash");
    expect(info.qualities).toEqual([127, 80, 64]);
    expect(info.videoByQuality[80]?.[7]?.baseUrl).toBe("https://up/v80-avc.m4s");
    expect(info.videoByQuality[64]?.[7]?.backupUrl).toEqual(["https://up2/v64-avc.m4s"]);
    expect(info.audioQualities).toEqual([30280, 30216]);
  });

  it("cheese：请求 pugv/player/web/playurl，带 avid/cid/ep_id，fnval=16", async () => {
    const info = await fetchPlayMediaInfo(makeCtx(), CHEESE_ITEM);
    expect(lastUrl).toContain("/pugv/player/web/playurl");
    expect(lastUrl).toContain("avid=10239235");
    expect(lastUrl).toContain("cid=280001");
    expect(lastUrl).toContain("ep_id=45");
    expect(lastUrl).toContain("fnval=16");
    expect(info.mediaType).toBe("dash");
  });

  it("pgc 无 dash 时走 result.durl 直链归一化", async () => {
    mode = "pgc-mp4";
    const info = await fetchPlayMediaInfo(makeCtx(), BANGUMI_ITEM);
    expect(info.mediaType).toBe("mp4");
    expect(info.durl?.[0]?.url).toBe("https://up/ep1.mp4");
    expect(info.qualities).toEqual([64, 32]);
  });

  it("pgc 登录/地区错误映射为 LOGIN_REQUIRED", async () => {
    mode = "pgc-login";
    await expect(fetchPlayMediaInfo(makeCtx(), BANGUMI_ITEM)).rejects.toMatchObject({ code: "LOGIN_REQUIRED" });
  });

  it("pugv 缺 ep_id 报 INVALID_URL", async () => {
    const { epId: _dropEp, ...noEp } = CHEESE_ITEM;
    void _dropEp;
    await expect(fetchPlayMediaInfo(makeCtx(), noEp)).rejects.toBeInstanceOf(BiliError);
  });

  it("www 类型委托 P1 语义：wbi 签名 + fnval=4048", async () => {
    const ctx = makeCtx();
    const { epId: _dropEp2, ...videoItem } = { ...BANGUMI_ITEM, id: "video:BV1xx:p1", type: "video" as const };
    void _dropEp2;
    await fetchPlayMediaInfo(ctx, videoItem);
    expect(lastUrl).toContain("/x/player/wbi/playurl");
    expect(lastUrl).toContain("wts=");
    expect(lastUrl).toContain("fnval=4048");
  });

  it("pugv snake_case 流字段归一化：base_url/backup_url/mime_type → StreamRef（cheese 真网回归）", async () => {
    mode = "pugv-snake";
    const info = await fetchPlayMediaInfo(makeCtx(), CHEESE_ITEM);
    expect(info.mediaType).toBe("dash");
    expect(info.videoByQuality[64]?.[7]?.baseUrl).toBe("https://up/pugv-v64.m4s");
    expect(info.videoByQuality[64]?.[7]?.backupUrl).toEqual(["https://up2/pugv-v64.m4s"]);
    expect(info.videoByQuality[64]?.[7]?.mimeType).toBe("video/mp4");
    expect(info.videoByQuality[64]?.[7]?.width).toBe(1280);
    expect(info.videoByQuality[16]?.[7]?.baseUrl).toBe("https://up/pugv-v16.m4s");
    expect(info.audioList.find((a) => a.id === 30216)?.baseUrl).toBe("https://up/pugv-a64.m4s");
  });
});

// ---------- audio / lesson 单文件直链 ----------

const AUDIO_ITEM: MediaItem = {
  id: "audio:au13526",
  type: "audio",
  auId: 13526,
  sid: 13526,
  page: 1,
  title: "unravel（东京食尸鬼）",
  groupTitle: "unravel（东京食尸鬼）",
  duration: 240,
  badge: "",
  cover: "",
  pubtime: 1501640768,
  owner: { mid: 282994, name: "泠鸢", face: "" },
  desc: "",
  url: "https://www.bilibili.com/audio/au13526",
};

const LESSON_ITEM: MediaItem = {
  id: "lesson:course10001:item30001:sec11",
  type: "lesson",
  courseId: 10001,
  lessonId: 20001,
  itemId: 30001,
  sectionId: 11,
  page: 1,
  title: "红岸基地",
  groupTitle: "三体艺术设定课",
  duration: 3600,
  badge: "",
  cover: "",
  pubtime: 0,
  owner: { mid: 0, name: "", face: "" },
  desc: "",
  url: "https://mall.bilibili.com/lesson/play?courseId=10001&lessonId=20001&itemId=30001",
};

let audioMode: "ok" | "error" = "ok";
let lessonMode: "ok" | "error" = "ok";
let lastMethod = "";
let lastBody = "";
let lastUrlAudioLesson = "";

function singleFileCtx(): ParseContext {
  lastMethod = "";
  lastBody = "";
  lastUrlAudioLesson = "";
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    lastUrlAudioLesson = url;
    lastMethod = String(init?.method ?? "GET");
    lastBody = typeof init?.body === "string" ? init.body : "";
    if (url.includes("/audio/music-service-c/web/url")) {
      if (audioMode === "error") {
        return new Response(JSON.stringify({ code: 4511001, message: "音频不存在" }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          code: 0,
          data: { sid: 13526, size: 5819735, cdns: ["https://upos/a.m4a?sign=1", "https://upos/b.m4a?sign=2"] },
        }),
        { status: 200 },
      );
    }
    if (url.includes("/mall-search-items/items/course/section/play/detail")) {
      if (lessonMode === "error") {
        return new Response(JSON.stringify({ code: 81100003, message: "请求错误，请稍后重试" }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ code: 0, data: { videoUrl: "https://upos/lesson.mp4?sign=1", videoTime: 1234 } }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ code: -404, message: "not found" }), { status: 200 });
  };
  return { http: new HttpClient({ fetchImpl: fetchImpl as typeof fetch }) };
}

describe("fetchPlayMediaInfo（audio/lesson 单文件直链）", () => {
  beforeEach(() => {
    audioMode = "ok";
    lessonMode = "ok";
  });

  it("audio：请求 music-service url?sid&privilege=2&quality=2，cdns 归一化为单段 durl + singleFileExt=m4a", async () => {
    const ctx = singleFileCtx();
    const info = await fetchPlayMediaInfo(ctx, AUDIO_ITEM);
    expect(lastUrlAudioLesson).toContain("/audio/music-service-c/web/url?sid=13526&privilege=2&quality=2");
    expect(info.mediaType).toBe("mp4");
    expect(info.singleFileExt).toBe("m4a");
    expect(info.mp4Qualities).toEqual([30280]);
    expect(info.durl).toHaveLength(1);
    expect(info.durl?.[0]?.url).toBe("https://upos/a.m4a?sign=1");
    expect(info.durl?.[0]?.backupUrl).toEqual(["https://upos/b.m4a?sign=2"]);
    expect(info.durl?.[0]?.size).toBe(5819735);
  });

  it("audio 接口业务错误（无该音频）映射 API_ERROR", async () => {
    audioMode = "error";
    await expect(fetchPlayMediaInfo(singleFileCtx(), AUDIO_ITEM)).rejects.toMatchObject({
      code: "API_ERROR",
      apiCode: 4511001,
    });
  });

  it("lesson：POST 播放详情，videoUrl 归一化为单段 durl + singleFileExt=mp4", async () => {
    const ctx = singleFileCtx();
    const info = await fetchPlayMediaInfo(ctx, LESSON_ITEM);
    expect(lastMethod).toBe("POST");
    expect(lastUrlAudioLesson).toContain("/mall-search-items/items/course/section/play/detail");
    expect(lastBody).toContain('"courseId":10001');
    expect(lastBody).toContain('"lessonId":20001');
    expect(lastBody).toContain('"itemId":30001');
    expect(lastBody).toContain('"sectionId":11');
    expect(info.singleFileExt).toBe("mp4");
    expect(info.mp4Qualities).toEqual([80]);
    expect(info.durl?.[0]?.url).toBe("https://upos/lesson.mp4?sign=1");
    expect(info.durl?.[0]?.length).toBe(1234000); // 秒 ×1000 毫秒
  });

  it("lesson 缺 sectionId 报 INVALID_URL", async () => {
    const { sectionId: _drop, ...noSection } = LESSON_ITEM;
    void _drop;
    await expect(fetchPlayMediaInfo(singleFileCtx(), noSection)).rejects.toBeInstanceOf(BiliError);
  });

  it("lesson 接口业务错误映射 API_ERROR", async () => {
    lessonMode = "error";
    await expect(fetchPlayMediaInfo(singleFileCtx(), LESSON_ITEM)).rejects.toMatchObject({
      code: "API_ERROR",
      apiCode: 81100003,
    });
  });
});
