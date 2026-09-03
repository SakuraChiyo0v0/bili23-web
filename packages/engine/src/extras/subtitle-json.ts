import type { SubtitleJson } from "./types.js";

/**
 * 字幕 JSON → JSON（对齐桌面 subtitles.py _to_json：json_dumps(data, indent=2)）。
 * 输出原始字幕 JSON 正文（body 结构原样保留）。
 */

export function toSubtitleJson(data: SubtitleJson): string {
  return JSON.stringify(data, null, 2);
}
