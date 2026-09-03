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
  /**
   * 单文件直链形态标记（audio=m4a / lesson=mp4，P2 Task 2.4）。
   * 存在时表示「下载即成品」：单条直链、无需 ffmpeg 合并，输出扩展名取该值。
   */
  singleFileExt?: "m4a" | "mp4";
  /** MP4 durl 引用（order 升序） */
  durl?: Array<{ order: number; url: string; backupUrl: string[]; size: number; length: number }>;
}

/** playurl 各端点（www=wbi、pgc/pugv）返回的载荷：www 在 data、pgc/pugv 在 result，结构一致 */
export interface PlayPayload {
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
      base_url?: string;
      backupUrl?: string[];
      backup_url?: string[];
      bandwidth?: number;
      mimeType?: string;
      mime_type?: string;
      codecs?: string;
      width?: number;
      height?: number;
    }>;
    audio?: Array<{
      id: number;
      codecid: number;
      baseUrl?: string;
      base_url?: string;
      backupUrl?: string[];
      backup_url?: string[];
      bandwidth?: number;
      mimeType?: string;
      mime_type?: string;
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
}

interface PlayurlResponse {
  code: number;
  message?: string;
  data?: PlayPayload;
}

interface DashStreamEntry {
  id: number;
  codecid: number;
  baseUrl?: string;
  base_url?: string;
  backupUrl?: string[];
  backup_url?: string[];
  bandwidth?: number;
  mimeType?: string;
  mime_type?: string;
  codecs?: string;
  width?: number;
  height?: number;
}

/** 收集条目可用的直链候选（对齐桌面 query_worker：baseUrl/base_url/backupUrl/backup_url/url） */
export function dashStreamUrls(e: DashStreamEntry): { baseUrl: string; backupUrl: string[] } {
  const baseUrl = e.baseUrl ?? e.base_url ?? "";
  const backupUrl = [...(e.backupUrl ?? []), ...(e.backup_url ?? [])];
  return { baseUrl, backupUrl };
}

function toStreamRef(e: DashStreamEntry): StreamRef {
  const { baseUrl, backupUrl } = dashStreamUrls(e);
  return {
    id: e.id,
    codecid: e.codecid,
    baseUrl,
    backupUrl,
    bandwidth: e.bandwidth ?? 0,
    mimeType: e.mimeType ?? e.mime_type ?? "",
    codecs: e.codecs ?? "",
    ...(e.width !== undefined ? { width: e.width } : {}),
    ...(e.height !== undefined ? { height: e.height } : {}),
  };
}

/** 业务错误码/文案 → 是否需要登录（www/pgc/pugv 通用） */
export function isLoginApiError(code: number, message: string | undefined): boolean {
  if (code === -101 || code === -10403) return true;
  return /登录|未登录/i.test(message ?? "");
}

/** 业务响应校验：code!==0 映射业务错误；code===0 返回载荷（data/result 已解包后传入） */
export function assertPlayOk(body: { code: number; message?: string }): void {
  if (body.code !== 0) {
    if (isLoginApiError(body.code, body.message)) {
      throw new BiliError("LOGIN_REQUIRED", body.message ?? "需要登录", { apiCode: body.code });
    }
    throw new BiliError("API_ERROR", body.message ?? "获取播放信息失败", { apiCode: body.code });
  }
}

/**
 * 把 playurl 载荷（data/result）归一化为 VideoMediaInfo。
 * DASH 存在时按画质→编码建映射；否则按 durl 直链归一化（MP4/FLV）。
 */
export function normalizePlayPayload(payload: PlayPayload): VideoMediaInfo {
  const timelength = payload.timelength ?? 0;
  const mp4Qualities = payload.accept_quality ?? [];
  const mp4QualityLabel: Record<number, string> = {};
  for (let i = 0; i < mp4Qualities.length; i += 1) {
    const q = mp4Qualities[i];
    if (q !== undefined) mp4QualityLabel[q] = payload.accept_description?.[i] ?? String(q);
  }

  const dash = payload.dash;
  if (dash?.video) {
    const videoByQuality: Record<number, Record<number, StreamRef>> = {};
    const qualitySet = new Set<number>();
    for (const v of dash.video) {
      const ref = toStreamRef(v);
      qualitySet.add(ref.id);
      const byCodec = videoByQuality[ref.id] ?? {};
      byCodec[ref.codecid] = ref;
      videoByQuality[ref.id] = byCodec;
    }
    const audioList = (dash.audio ?? [])
      .map((a) => toStreamRef(a))
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
  const durl = (payload.durl ?? [])
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

/**
 * 拉取投稿视频媒体信息（可选画质/编码/音频）。
 * 语义对齐桌面 previewer.get_video_info：qn=80、fnver=0、fnval=4048、fourk=1，WBI 签名。
 * 投稿视频以外的类型请走 fetchPlayMediaInfo（本函数为 www flavor 实现）。
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

  assertPlayOk(body);
  if (!body.data) {
    throw new BiliError("API_ERROR", "playurl 接口缺少 data");
  }

  return normalizePlayPayload(body.data);
}
