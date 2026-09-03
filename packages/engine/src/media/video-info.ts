import { BiliError } from "../errors.js";
import { wbiSign } from "../api/wbi.js";
import type { ParseContext } from "../parser/types.js";
import { ensureWbiKeys } from "./wbi-keys.js";

/** DASH/MP4 流引用（含候选地址） */
export interface StreamRef {
  id: number;
  codecid: number;
  baseUrl: string;
  backupUrl: string[];
  bandwidth: number;
  mimeType: string;
  codecs: string;
  width?: number;
  height?: number;
}

export type VideoMediaType = "dash" | "mp4";

/** 一次 playurl 请求得到的媒体信息（对齐桌面"预览"信息） */
export interface VideoMediaInfo {
  mediaType: VideoMediaType;
  /** 总时长（毫秒） */
  timelength: number;
  /** 可选画质 id，降序去重 */
  qualities: number[];
  /** 画质 → 编码(codecid) → 流引用（DASH 专用） */
  videoByQuality: Record<number, Record<number, StreamRef>>;
  /** 音频流列表（DASH），按 id 降序 */
  audioList: StreamRef[];
  /** 可选音质 id 降序 */
  audioQualities: number[];
  /** MP4 直链（durl）时的可用画质/标签 */
  mp4Qualities: number[];
  mp4QualityLabel: Record<number, string>;
  /** MP4 durl 引用（order 升序） */
  durl?: Array<{ order: number; url: string; backupUrl: string[]; size: number; length: number }>;
}

interface PlayurlResponse {
  code: number;
  message?: string;
  data?: {
    timelength?: number;
    format?: string;
    quality?: number;
    accept_quality?: number[];
    accept_description?: string[];
    dash?: {
      duration?: number;
      video?: Array<{
        id: number;
        codecid: number;
        baseUrl?: string;
        backupUrl?: string[];
        bandwidth?: number;
        mimeType?: string;
        codecs?: string;
        width?: number;
        height?: number;
      }>;
      audio?: Array<{
        id: number;
        codecid: number;
        baseUrl?: string;
        backupUrl?: string[];
        bandwidth?: number;
        mimeType?: string;
        codecs?: string;
      }>;
    };
    durl?: Array<{
      order: number;
      url: string;
      backup_url?: string[];
      size?: number;
      length?: number;
    }>;
  };
}

function toStreamRef(
  e: { id: number; codecid: number; baseUrl?: string; bandwidth?: number; mimeType?: string; codecs?: string },
  backupUrl?: string[],
): StreamRef {
  return {
    id: e.id,
    codecid: e.codecid,
    baseUrl: e.baseUrl ?? "",
    backupUrl: backupUrl ?? [],
    bandwidth: e.bandwidth ?? 0,
    mimeType: e.mimeType ?? "",
    codecs: e.codecs ?? "",
  };
}

/** 业务错误码 → 是否需要登录 */
function isLoginError(code: number, message: string | undefined): boolean {
  if (code === -101 || code === -10403) return true;
  return /登录|未登录/i.test(message ?? "");
}

/**
 * 拉取投稿视频媒体信息（可选画质/编码/音频）。
 * 语义对齐桌面 previewer.get_video_info：qn=80、fnver=0、fnval=4048、fourk=1，WBI 签名。
 */
export async function fetchVideoMediaInfo(
  ctx: ParseContext,
  item: { bvid: string; aid?: number; cid: number },
): Promise<VideoMediaInfo> {
  const { imgKey, subKey } = await ensureWbiKeys(ctx);
  const signed = wbiSign(
    { bvid: item.bvid, cid: item.cid, qn: 80, fnver: 0, fnval: 4048, fourk: 1 },
    imgKey,
    subKey,
  );

  const body = await ctx.http.getJSON<PlayurlResponse>(
    "https://api.bilibili.com/x/player/wbi/playurl",
    { params: signed },
  );

  if (body.code !== 0) {
    if (isLoginError(body.code, body.message)) {
      throw new BiliError("LOGIN_REQUIRED", body.message ?? "需要登录", { apiCode: body.code });
    }
    throw new BiliError("API_ERROR", body.message ?? "获取播放信息失败", { apiCode: body.code });
  }
  if (!body.data) {
    throw new BiliError("API_ERROR", "playurl 接口缺少 data");
  }

  const data = body.data;
  const timelength = data.timelength ?? 0;
  const mp4Qualities = data.accept_quality ?? [];
  const mp4QualityLabel: Record<number, string> = {};
  for (let i = 0; i < mp4Qualities.length; i += 1) {
    const q = mp4Qualities[i];
    if (q !== undefined) mp4QualityLabel[q] = data.accept_description?.[i] ?? String(q);
  }

  const dash = data.dash;
  if (dash?.video) {
    const videoByQuality: Record<number, Record<number, StreamRef>> = {};
    const qualitySet = new Set<number>();
    for (const v of dash.video) {
      const ref = toStreamRef(v, v.backupUrl);
      qualitySet.add(ref.id);
      const byCodec = videoByQuality[ref.id] ?? {};
      byCodec[ref.codecid] = ref;
      videoByQuality[ref.id] = byCodec;
    }
    const audioList = (dash.audio ?? [])
      .map((a) => toStreamRef(a, a.backupUrl))
      .sort((a, b) => b.id - a.id);
    const audioQualities = [...new Set(audioList.map((a) => a.id))].sort((a, b) => b - a);

    return {
      mediaType: "dash",
      timelength,
      qualities: [...qualitySet].sort((a, b) => b - a),
      videoByQuality,
      audioList,
      audioQualities,
      mp4Qualities,
      mp4QualityLabel,
    };
  }

  // 非 DASH：MP4/FLV 直链
  const durl = (data.durl ?? [])
    .map((d) => ({
      order: d.order,
      url: d.url,
      backupUrl: d.backup_url ?? [],
      size: d.size ?? 0,
      length: d.length ?? 0,
    }))
    .sort((a, b) => a.order - b.order);

  return {
    mediaType: "mp4",
    timelength,
    qualities: [...mp4Qualities].sort((a, b) => b - a),
    videoByQuality: {},
    audioList: [],
    audioQualities: [],
    mp4Qualities,
    mp4QualityLabel,
    durl,
  };
}
