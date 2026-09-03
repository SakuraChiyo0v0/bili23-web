import type { SubtitleJson } from "./types.js";
import { formatSrtTime } from "./time.js";

/**
 * 字幕 JSON → SRT（对齐桌面 subtitles.py _to_srt）。
 * SRT 编号从 1 开始；from/to 单位为秒。
 */

export function toSubtitleSrt(data: SubtitleJson): string {
  const lines: string[] = [];
  const body = data.body ?? [];
  for (let i = 0; i < body.length; i += 1) {
    const item = body[i];
    if (!item) continue;
    const start = item.from ?? 0;
    const end = item.to ?? 0;
    const content = item.content ?? "";
    lines.push(String(i + 1));
    lines.push(`${formatSrtTime(start)} --> ${formatSrtTime(end)}`);
    lines.push(`${content}\n`);
  }
  return lines.join("\n").trim();
}
