import type { SubtitleJson } from "./types.js";

/**
 * 字幕 JSON → LRC（对齐桌面 subtitles.py _to_lrc）。
 * 时间格式 [MM:SS.xx]，分钟两位、秒保留两位小数（Python `{s:05.2f}` 语义）。
 */

export function toSubtitleLrc(data: SubtitleJson): string {
  const lines: string[] = [];
  for (const item of data.body ?? []) {
    const start = item.from ?? 0;
    const content = item.content ?? "";
    const m = Math.floor(start / 60);
    const s = start % 60;
    lines.push(`[${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}]${content}`);
  }
  return lines.join("\n").trim();
}
