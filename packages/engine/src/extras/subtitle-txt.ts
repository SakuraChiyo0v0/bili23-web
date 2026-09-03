import type { SubtitleJson } from "./types.js";

/**
 * 字幕 JSON → 纯文本（对齐桌面 subtitles.py _to_txt：逐条 content 换行）。
 */

export function toSubtitleTxt(data: SubtitleJson): string {
  const lines: string[] = [];
  for (const item of data.body ?? []) {
    lines.push(item.content ?? "");
  }
  return lines.join("\n").trim();
}
