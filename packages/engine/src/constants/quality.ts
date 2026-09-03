/**
 * 画质/音质/编码常量。
 * 数值与键名对齐桌面版 src/util/common/data/media_info.py，改动需与桌面版同步。
 */

/** 画质 id 表（键名 → B 站 qn） */
export const VIDEO_QUALITY = {
  AUTO: 200,
  "8K": 127,
  DOLBY_VISION: 126,
  HDR: 125,
  "4K_SDR": 122,
  "4K": 120,
  "1080P60": 116,
  "1080P+": 112,
  AI: 100,
  "1080P": 80,
  "720P": 64,
  "480P": 32,
  "360P": 16,
} as const;

export type VideoQualityKey = keyof typeof VIDEO_QUALITY;

export const REVERSED_VIDEO_QUALITY: Readonly<Record<number, VideoQualityKey>> = Object.fromEntries(
  Object.entries(VIDEO_QUALITY).map(([k, v]) => [v, k]),
) as Readonly<Record<number, VideoQualityKey>>;

/** 音质 id 表（键名 → B 站 audio_quality） */
export const AUDIO_QUALITY = {
  AUTO: 30300,
  HI_RES: 30251,
  DOLBY_ATMOS: 30250,
  "192K": 30280,
  "132K": 30232,
  "64K": 30216,
} as const;

export type AudioQualityKey = keyof typeof AUDIO_QUALITY;

export const REVERSED_AUDIO_QUALITY: Readonly<Record<number, AudioQualityKey>> = Object.fromEntries(
  Object.entries(AUDIO_QUALITY).map(([k, v]) => [v, k]),
) as Readonly<Record<number, AudioQualityKey>>;

/**
 * 音质候选优先级（桌面版用于从高到低排序可选音质）。
 * 30255 = 杜比视界伴音等罕见档位，排在最前但仅当接口返回时参与。
 */
export const AUDIO_REORDER: ReadonlyArray<number> = [30255, 30251, 30250, 30280, 30232, 30216];

/** 音频编码：展示名 → codecid/format 串 */
export const AUDIO_CODEC = {
  "AAC LC": "mp4a.40.2",
  FLAC: "fLaC",
} as const;

/** 视频编码（键名 → B 站 codecid） */
export const VIDEO_CODEC = {
  AUTO: 20,
  "AVC/H.264": 7,
  "HEVC/H.265": 12,
  AV1: 13,
} as const;

export type VideoCodecKey = keyof typeof VIDEO_CODEC;

/** codecid → 展示名（用于流描述，如 "AVC"） */
export const VIDEO_CODEC_STR: Readonly<Record<number, string>> = {
  7: "AVC",
  12: "HEVC",
  13: "AV1",
};

export const REVERSED_VIDEO_CODEC: Readonly<Record<number, VideoCodecKey>> = Object.fromEntries(
  Object.entries(VIDEO_CODEC).map(([k, v]) => [v, k]),
) as Readonly<Record<number, VideoCodecKey>>;

/** 按 id 取画质标签；未知返回 "未知画质"（与桌面 UI 习惯一致） */
export function videoQualityLabel(id: number): string {
  return REVERSED_VIDEO_QUALITY[id] ?? `画质${id}`;
}

/** 按 id 取音质标签 */
export function audioQualityLabel(id: number): string {
  return REVERSED_AUDIO_QUALITY[id] ?? `音质${id}`;
}
