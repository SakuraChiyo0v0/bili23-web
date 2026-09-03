import { BiliError } from "../errors.js";
import { AUDIO_QUALITY } from "../constants/quality.js";
import type { VideoMediaInfo, StreamRef } from "../media/video-info.js";

/** 画质自动哨兵：200 = 按优先级自动选择（对齐桌面 video_quality_id == 200） */
export const AUTO_QUALITY = 200;
/** 编码自动哨兵：20 = 按优先级自动选择（对齐桌面 video_codec_id == 20） */
export const AUTO_CODEC = 20;
/** 音质自动哨兵：0 = 不指定，按优先级自动（对齐桌面任务默认 audio_quality_id == 0） */
export const AUTO_AUDIO_QUALITY = 0;

/** 画质优先级（高→低），对齐桌面 config.video_quality_priority */
export const DEFAULT_VIDEO_QUALITY_PRIORITY = [127, 126, 125, 122, 120, 116, 112, 100, 80, 64, 32, 16];
/** 编码优先级：优先 AVC(H.264) 兼容性，对齐桌面 config.video_codec_priority */
export const DEFAULT_VIDEO_CODEC_PRIORITY = [7, 12, 13];
/**
 * 音质优先级，对齐桌面 config.audio_quality_priority：
 * Hi-Res(30251) > 杜比(30250) > 192K(30280) > 132K(30232) > 64K(30216)。
 * 注：30255 只参与展示排序（AUDIO_REORDER），选流时桌面会先把它归一为 30250。
 */
export const DEFAULT_AUDIO_QUALITY_PRIORITY = [30251, 30250, 30280, 30232, 30216];

export interface StreamOptions {
  /** 目标画质 id；缺省 200（按优先级自动） */
  videoQualityId?: number;
  /** 目标编码 codecid；缺省 20（按优先级自动） */
  videoCodecId?: number;
  /** 目标音质 id；缺省 0（按优先级自动） */
  audioQualityId?: number;
  /** 画质优先级（覆盖默认，从高到低） */
  videoQualityPriority?: number[];
  /** 编码优先级（覆盖默认） */
  videoCodecPriority?: number[];
  /** 音质优先级（覆盖默认） */
  audioQualityPriority?: number[];
}

export interface ResolvedStreams {
  mediaType: "dash" | "mp4";
  /** 实际选定的画质 id */
  videoQualityId: number;
  /** 实际选定的编码 codecid */
  videoCodecId: number;
  /** 实际选定的音质 id；0 表示无音频流（仅视频） */
  audioQualityId: number;
  /** DASH 视频流引用（已选定画质+编码） */
  videoRef?: StreamRef;
  /** DASH 音频流引用（未选中时为 undefined） */
  audioRef?: StreamRef | undefined;
  /** MP4/FLV 直链分片（order 升序） */
  durl?: Array<{ order: number; url: string; backupUrl: string[]; size: number; length: number }>;
  /** 下载到本地临时媒体的扩展名（DASH=m4s / 直链=mp4） */
  videoExt: "m4s" | "mp4";
}

/** 按优先级顺序返回第一个出现在可用列表里的值；都未命中返回 undefined */
function firstMatch(priority: readonly number[], available: readonly number[]): number | undefined {
  for (const p of priority) {
    if (available.includes(p)) return p;
  }
  return undefined;
}

/**
 * 根据用户选项（自动/指定）在媒体信息里选定画质/编码/音质。
 * 语义对齐桌面 download/parse/video_info.py 的 get_video_info 与
 * download/parse/audio_info.py 的 get_audio_info：
 * - 自动：按优先级取第一个可用；
 * - 显式指定但不可用：画质/编码回退到可用列表第一位（桌面 available_*_list[0]），
 *   音频则禁用（桌面清掉 AUDIO 类型位，只下载视频）。
 */
export function resolveStreams(info: VideoMediaInfo, opts: StreamOptions = {}): ResolvedStreams {
  const qualityPriority = opts.videoQualityPriority ?? DEFAULT_VIDEO_QUALITY_PRIORITY;
  const codecPriority = opts.videoCodecPriority ?? DEFAULT_VIDEO_CODEC_PRIORITY;
  const audioPriority = opts.audioQualityPriority ?? DEFAULT_AUDIO_QUALITY_PRIORITY;

  const requestedQuality = opts.videoQualityId ?? AUTO_QUALITY;

  if (info.mediaType === "dash") {
    const qualityPool = info.qualities;
    if (qualityPool.length === 0) {
      throw new BiliError("DOWNLOAD_FAILED", "没有可用视频流");
    }

    // 画质：自动按优先级；显式但不可用回退到最高可用画质（桌面 available_quality_list[0]）
    const videoQualityId =
      requestedQuality === AUTO_QUALITY
        ? (firstMatch(qualityPriority, qualityPool) ?? qualityPool[0]!)
        : qualityPool.includes(requestedQuality)
          ? requestedQuality
          : qualityPool[0]!;

    const byCodec = info.videoByQuality[videoQualityId];
    const codecPool = byCodec ? Object.keys(byCodec).map(Number) : [];
    if (byCodec === undefined || codecPool.length === 0) {
      throw new BiliError("DOWNLOAD_FAILED", `画质 ${videoQualityId} 没有可用编码流`);
    }

    // 编码：自动按优先级；显式但不可用回退到该画质第一个编码（桌面 available_codec_list[0]）
    const requestedCodec = opts.videoCodecId ?? AUTO_CODEC;
    const videoCodecId =
      requestedCodec === AUTO_CODEC
        ? (firstMatch(codecPriority, codecPool) ?? codecPool[0]!)
        : codecPool.includes(requestedCodec)
          ? requestedCodec
          : codecPool[0]!;

    const videoRef = byCodec[videoCodecId];
    if (!videoRef) {
      throw new BiliError("DOWNLOAD_FAILED", `画质 ${videoQualityId}/编码 ${videoCodecId} 流不存在`);
    }

    // 音频：自动（0 或 30300）按优先级取第一个可用；显式指定但不可用 → 无音频
    const audioPool = info.audioQualities;
    const requestedAudio = opts.audioQualityId ?? AUTO_AUDIO_QUALITY;
    const isAutoAudio = requestedAudio === AUTO_AUDIO_QUALITY || requestedAudio === AUDIO_QUALITY.AUTO;
    let audioQualityId: number | undefined;
    if (audioPool.length > 0) {
      if (isAutoAudio) {
        audioQualityId = firstMatch(audioPriority, audioPool);
      } else if (audioPool.includes(requestedAudio)) {
        audioQualityId = requestedAudio;
      }
    }
    const audioRef = audioQualityId !== undefined ? info.audioList.find((a) => a.id === audioQualityId) : undefined;

    return {
      mediaType: "dash",
      videoQualityId,
      videoCodecId,
      audioQualityId: audioQualityId ?? AUTO_AUDIO_QUALITY,
      videoRef,
      audioRef,
      videoExt: "m4s",
    };
  }

  // MP4/FLV 直链：画质从 accept_quality 中选（桌面 _get_mp4_available_quality_list），
  // 取流统一使用接口返回的 durl 分片
  const mp4Pool = info.mp4Qualities;
  if (mp4Pool.length === 0 || !info.durl || info.durl.length === 0) {
    throw new BiliError("DOWNLOAD_FAILED", "没有可用的 MP4 直链分片");
  }
  const videoQualityId =
    requestedQuality === AUTO_QUALITY
      ? (firstMatch(qualityPriority, mp4Pool) ?? mp4Pool[0]!)
      : mp4Pool.includes(requestedQuality)
        ? requestedQuality
        : mp4Pool[0]!;

  return {
    mediaType: "mp4",
    videoQualityId,
    videoCodecId: 7,
    audioQualityId: AUTO_AUDIO_QUALITY,
    durl: info.durl,
    videoExt: "mp4",
  };
}

