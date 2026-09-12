/**
 * 媒体信息卡上那些**单位格式化**与固定说明 —— 逐条对齐原版
 * `util/format/units.py` 与 `dialog/download_options/card.py:104-190`。
 *
 * ⚠️ 不要和 `lib/taskText.ts` 里的 `fmtBytes` 混用：那是**任务卡**的格式
 * （`Units.format_file_size` 在任务卡上按原版取整规则显示），媒体信息卡这里按原版
 * 一律 `{:.2f}` 两位小数。
 */

/** 文件大小：原版 `Units.format_file_size`（1024 进制、两位小数） */
export function fmtFileSize(size: number): string {
  if (!size || size <= 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = size;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return `${n.toFixed(2)} ${units[i]}`;
}

/** 码率：原版 `Units.format_bitrate`（1000 进制） */
export function fmtBitrate(bps: number): string {
  if (!bps || bps <= 0) return "";
  const units = ["bps", "Kbps", "Mbps", "Gbps"];
  let n = bps;
  let i = 0;
  while (n >= 1000 && i < units.length - 1) { n /= 1000; i += 1; }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** 帧率：原版 `Units.format_frame_rate`（一位小数 + " fps"） */
export function fmtFrameRate(frameRate?: string | number): string {
  const n = Number(frameRate);
  if (!Number.isFinite(n) || n <= 0) return "";
  return `${n.toFixed(1)} fps`;
}

/**
 * 编码说明（原版 `MediaInfoCard.get_codec_tip`）：7=AVC / 12=HEVC / 13=AV1。
 * 值是**简中原文**（= i18n 字典的键），取用处再 `tr()`。
 */
export const CODEC_NOTE: Record<number, string> = {
  7: "文件体积大，兼容性强",
  12: "文件体积小，但兼容性较差",
  13: "压缩效率最高，但兼容性最差",
};

/** 没有音频流时的原因（原版 `on_query_audio_info` 按媒体类型分派） */
export function noAudioReason(mediaType: "dash" | "mp4" | undefined): string {
  if (mediaType === "dash") return "无声视频流，不包含音轨";
  if (mediaType === "mp4") return "视频流中已包含音轨";
  return "将按优先级自动选择音质";
}

/**
 * 音频编码名（原版 `util/common/data/media_info.py` 的 `reversed_audio_codec_map`：
 * `{"mp4a.40.2": "AAC LC", "fLaC": "FLAC"}`）。认不出就原样返回 codecs 字符串 —— 与原版
 * `reversed_audio_codec_map.get(info["codec"], info["codec"])` 的兜底一致。
 */
export const AUDIO_CODEC_NAME: Record<string, string> = {
  "mp4a.40.2": "AAC LC",
  fLaC: "FLAC",
};

export function audioCodecName(codecs?: string): string {
  if (!codecs) return "";
  return AUDIO_CODEC_NAME[codecs] ?? codecs;
}

/** 估大小（DASH 没有真实 size：码率 × 时长 ÷ 8）；拿不到码率返回空串 */
export function estimateSize(bytes: number | undefined, bandwidth: number, timelengthMs: number): string {
  if (bytes && bytes > 0) return fmtFileSize(bytes); // MP4/durl 有真实 size
  if (!bandwidth || bandwidth <= 0 || timelengthMs <= 0) return "";
  return fmtFileSize((bandwidth * (timelengthMs / 1000)) / 8);
}
