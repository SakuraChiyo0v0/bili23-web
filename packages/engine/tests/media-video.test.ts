import { beforeEach, describe, expect, it } from "vitest";
import { HttpClient } from "../src/api/http.js";
import { fetchVideoMediaInfo } from "../src/media/video-info.js";
import { resetWbiKeyCache } from "../src/media/wbi-keys.js";
import type { ParseContext } from "../src/parser/types.js";

const NAV_BODY = {
  code: 0,
  data: {
    wbi_img: {
      img_url: "https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png",
      sub_url: "https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png",
    },
  },
};

const DASH_BODY = {
  code: 0,
  data: {
    timelength: 213000,
    accept_quality: [127, 126, 120, 80, 64],
    accept_description: ["8K", "杜比视界", "4K", "1080P", "720P"],
    dash: {
      video: [
        { id: 127, codecid: 13, baseUrl: "https://up/v127-av1.m4s", codecs: "av01.0.05M.08", bandwidth: 8000000, mimeType: "video/mp4" },
        { id: 127, codecid: 12, baseUrl: "https://up/v127-hevc.m4s", codecs: "hev1.1.6.L153", bandwidth: 7000000, mimeType: "video/mp4" },
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

const MP4_BODY = {
  code: 0,
  data: {
    timelength: 60000,
    format: "mp4",
    quality: 32,
    accept_quality: [64, 32, 16],
    accept_description: ["720P", "480P", "360P"],
    durl: [
      { order: 1, url: "https://up/v1.mp4", size: 1000, length: 60000 },
    ],
  },
};

let navCount = 0;
let lastPlayUrl = "";

function makeCtx(): ParseContext {
  navCount = 0;
  lastPlayUrl = "";
  const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    if (url.includes("/x/web-interface/nav")) {
      navCount += 1;
      return new Response(JSON.stringify(NAV_BODY), { status: 200 });
    }
    if (url.includes("/x/player/wbi/playurl")) {
      lastPlayUrl = url;
      const body = url.includes("need-mp4") ? MP4_BODY : DASH_BODY;
      return new Response(JSON.stringify(body), { status: 200 });
    }
    return new Response(JSON.stringify({ code: -404, message: "not found" }), { status: 200 });
  };
  return { http: new HttpClient({ fetchImpl: fetchImpl as typeof fetch }) };
}

const ITEM = { bvid: "BV1xx411c7mD", cid: 280001 };

beforeEach(() => {
  resetWbiKeyCache();
});

describe("fetchVideoMediaInfo", () => {
  it("DASH：返回降序画质、画质→编码映射与降序音质", async () => {
    const info = await fetchVideoMediaInfo(makeCtx(), ITEM);
    expect(info.mediaType).toBe("dash");
    expect(info.timelength).toBe(213000);
    expect(info.qualities).toEqual([127, 80, 64]);
    expect(Object.keys(info.videoByQuality[127] ?? {}).map(Number).sort((a, b) => a - b)).toEqual([12, 13]);
    expect(info.videoByQuality[80]?.[7]?.baseUrl).toBe("https://up/v80-avc.m4s");
    expect(info.videoByQuality[64]?.[7]?.backupUrl).toEqual(["https://up2/v64-avc.m4s"]);
    expect(info.audioQualities).toEqual([30280, 30216]);
    expect(info.audioList[0]?.id).toBe(30280);
  });

  it("playurl 请求带 WBI 签名（wts 与 w_rid）", async () => {
    await fetchVideoMediaInfo(makeCtx(), ITEM);
    expect(lastPlayUrl).toContain("wts=");
    expect(lastPlayUrl).toContain("w_rid=");
    expect(lastPlayUrl).toContain("fnval=4048");
    expect(lastPlayUrl).toContain("fourk=1");
  });

  it("WBI key 进程内缓存：两次请求只访问一次 nav", async () => {
    const ctx = makeCtx();
    await fetchVideoMediaInfo(ctx, ITEM);
    await fetchVideoMediaInfo(ctx, ITEM);
    expect(navCount).toBe(1);
  });

  it("无 dash 时走 MP4 直链（accept_quality + durl）", async () => {
    const ctx = makeCtx();
    ctx.http = new HttpClient({
      fetchImpl: (async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("nav")) return new Response(JSON.stringify(NAV_BODY), { status: 200 });
        return new Response(JSON.stringify(MP4_BODY), { status: 200 });
      }) as typeof fetch,
    });
    const info = await fetchVideoMediaInfo(ctx, ITEM);
    expect(info.mediaType).toBe("mp4");
    expect(info.qualities).toEqual([64, 32, 16]);
    expect(info.mp4QualityLabel[64]).toBe("720P");
    expect(info.durl?.[0]?.url).toBe("https://up/v1.mp4");
  });

  it("需登录错误映射为 LOGIN_REQUIRED", async () => {
    const ctx = makeCtx();
    ctx.http = new HttpClient({
      fetchImpl: (async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("nav")) return new Response(JSON.stringify(NAV_BODY), { status: 200 });
        return new Response(JSON.stringify({ code: -10403, message: "请先登录" }), { status: 200 });
      }) as typeof fetch,
    });
    await expect(fetchVideoMediaInfo(ctx, ITEM)).rejects.toMatchObject({
      code: "LOGIN_REQUIRED",
      apiCode: -10403,
    });
  });
});
