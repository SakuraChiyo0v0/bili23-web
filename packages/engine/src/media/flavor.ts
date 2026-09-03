import { BiliError } from "../errors.js";
import type { ParseContext } from "../parser/types.js";
import type { MediaItem } from "../types.js";
import { fetchVideoMediaInfo, normalizePlayPayload, assertPlayOk, isLoginApiError } from "./video-info.js";
import type { PlayPayload, VideoMediaInfo } from "./video-info.js";

/**
 * playurl 取流 flavor 分发（语义对齐桌面 downloader/parse_worker.get_info）：
 * - video（投稿/互动）→ www：x/player/wbi/playurl（WBI 签名，fnval 4048）
 * - bangumi（番剧）→ pgc：pgc/player/web/playurl（明文，fnval 143312，响应在 result）
 * - cheese（课堂课程）→ pugv：pugv/player/web/playurl（明文，fnval 16，avid+cid+ep_id，响应在 result）
 * - audio（音乐）→ audio：music-service-c/web/url（m4a 单文件）
 * - lesson（商城课程）→ lesson：mall 播放详情 POST（单 mp4 直链）
 */

export type PlayFlavor = "www" | "pgc" | "pugv" | "audio" | "lesson";

/** 条目叶子类型 → 取流 flavor */
export function flavorOf(item: Pick<MediaItem, "type">): PlayFlavor {
  switch (item.type) {
    case "video":
      return "www";
    case "bangumi":
      return "pgc";
    case "cheese":
      return "pugv";
    case "audio":
      return "audio";
    case "lesson":
      return "lesson";
  }
}

interface FlavorResponse {
  code: number;
  message?: string;
  data?: PlayPayload;
  result?: PlayPayload;
}

function assertField(value: unknown, label: string): asserts value {
  if (value === undefined || value === null || value === "") {
    throw new BiliError("INVALID_URL", `缺少${label}，无法获取播放信息`);
  }
}

/** 明文（非 wbi）GET 一个 playurl 端点并归一化 */
async function fetchPlainFlavor(
  ctx: ParseContext,
  url: string,
  params: Record<string, string | number>,
): Promise<VideoMediaInfo> {
  const body = await ctx.http.getJSON<FlavorResponse>(url, { params });
  assertPlayOk(body);
  const payload = body.result ?? body.data;
  if (!payload) {
    throw new BiliError("API_ERROR", "playurl 接口缺少返回数据");
  }
  return normalizePlayPayload(payload);
}

/**
 * 按条目类型拉取媒体信息（可选画质/编码/音频）。
 * 归一化结果与 P1 的 fetchVideoMediaInfo 一致，resolver/downloader 可直接复用。
 * audio/lesson 属"单文件直链"形态：打上 singleFileExt 标记，下载侧无需 ffmpeg 合并。
 */
export async function fetchPlayMediaInfo(
  ctx: ParseContext,
  item: Pick<MediaItem, "type" | "bvid" | "aid" | "cid" | "epId" | "sid" | "courseId" | "lessonId" | "itemId" | "sectionId">,
): Promise<VideoMediaInfo> {
  switch (flavorOf(item)) {
    case "www": {
      assertField(item.bvid, "bvid");
      assertField(item.cid, "cid");
      return fetchVideoMediaInfo(ctx, { bvid: item.bvid, cid: item.cid });
    }
    case "pgc": {
      assertField(item.bvid, "bvid");
      assertField(item.cid, "cid");
      return fetchPlainFlavor(ctx, "https://api.bilibili.com/pgc/player/web/playurl", {
        bvid: item.bvid,
        cid: item.cid,
        qn: 80,
        fnver: 0,
        fnval: 143312,
        fourk: 1,
      });
    }
    case "pugv": {
      assertField(item.aid, "aid");
      assertField(item.cid, "cid");
      assertField(item.epId, "ep_id");
      return fetchPlainFlavor(ctx, "https://api.bilibili.com/pugv/player/web/playurl", {
        avid: item.aid,
        cid: item.cid,
        qn: 80,
        fnver: 0,
        fnval: 16,
        fourk: 1,
        ep_id: item.epId,
      });
    }
    case "audio":
      assertField(item.sid, "sid");
      return fetchAudioMediaInfo(ctx, { sid: item.sid });
    case "lesson":
      assertField(item.courseId, "courseId");
      assertField(item.lessonId, "lessonId");
      assertField(item.itemId, "itemId");
      assertField(item.sectionId, "sectionId");
      return fetchLessonMediaInfo(ctx, {
        courseId: item.courseId,
        lessonId: item.lessonId,
        itemId: item.itemId,
        sectionId: item.sectionId,
      });
  }
}

/** audio/music-service-c/web/url 响应（只声明本模块用到的字段） */
interface AudioUrlResponse {
  code: number;
  message?: string;
  data?: {
    sid?: number;
    size?: number;
    cdns?: string[];
  };
}

/**
 * 音频取流：music-service 单曲直链（m4a）。
 * 语义对齐桌面 download/parse/audio_info.py：url?sid&privilege=2&quality=2 →
 * data.cdns 为候选地址（桌面把它当作 backup_url 交给 query_worker 探测）。
 * 产物为单文件 m4a，无需 ffmpeg 合并。
 */
export async function fetchAudioMediaInfo(
  ctx: ParseContext,
  item: { sid: number },
): Promise<VideoMediaInfo> {
  const body = await ctx.http.getJSON<AudioUrlResponse>(
    "https://www.bilibili.com/audio/music-service-c/web/url",
    { params: { sid: item.sid, privilege: 2, quality: 2 } },
  );
  assertPlayOk(body);
  const cdns = body.data?.cdns ?? [];
  const url = cdns[0];
  if (!url) {
    throw new BiliError("API_ERROR", "音频接口未返回下载地址");
  }
  return {
    mediaType: "mp4",
    timelength: 0,
    qualities: [],
    videoByQuality: {},
    audioList: [],
    audioQualities: [],
    mp4Qualities: [30280],
    mp4QualityLabel: { 30280: "192K" },
    durl: [
      {
        order: 1,
        url,
        backupUrl: cdns.slice(1),
        size: body.data?.size ?? 0,
        length: 0,
      },
    ],
    singleFileExt: "m4a",
  };
}

/** mall 课程小节播放详情响应 */
interface LessonPlayDetailResponse {
  code: number;
  message?: string;
  data?: {
    videoUrl?: string;
    videoTime?: number;
  };
}

/** mall 商城课程业务码 → 错误（登录缺失与参数错误难以区分，按文案启发式） */
function assertLessonOk(body: { code: number; message?: string }): void {
  if (body.code !== 0) {
    if (isLoginApiError(body.code, body.message)) {
      throw new BiliError("LOGIN_REQUIRED", body.message ?? "需要登录后观看商城课程", { apiCode: body.code });
    }
    throw new BiliError("API_ERROR", body.message ?? "获取课程播放地址失败", { apiCode: body.code });
  }
}

/**
 * 商城课程取流：POST 播放详情 → data.videoUrl 单条 mp4 直链。
 * 语义对齐桌面 lesson.py build_lesson_play_payload + build_lesson_media_info：
 * 包装成 playurl durl 形态（quality 取标称值 80），产物为单文件 mp4。
 */
export async function fetchLessonMediaInfo(
  ctx: ParseContext,
  item: { courseId: number; lessonId: number; itemId: number; sectionId: number },
): Promise<VideoMediaInfo> {
  const body = await ctx.http.postJSON<LessonPlayDetailResponse>(
    "https://mall.bilibili.com/mall-search-items/items/course/section/play/detail",
    {
      json: {
        courseId: item.courseId,
        lessonId: item.lessonId,
        itemId: item.itemId,
        sectionId: item.sectionId,
      },
      headers: { Referer: "https://mall.bilibili.com/", Origin: "https://mall.bilibili.com" },
    },
  );
  assertLessonOk(body);
  const videoUrl = body.data?.videoUrl;
  if (!videoUrl) {
    throw new BiliError("API_ERROR", "接口未返回该小节的播放地址");
  }
  return {
    mediaType: "mp4",
    timelength: 0,
    qualities: [],
    videoByQuality: {},
    audioList: [],
    audioQualities: [],
    mp4Qualities: [80],
    mp4QualityLabel: { 80: "1080P" },
    durl: [
      {
        order: 1,
        url: videoUrl,
        backupUrl: [],
        size: 0,
        length: (body.data?.videoTime ?? 0) * 1000,
      },
    ],
    singleFileExt: "mp4",
  };
}
