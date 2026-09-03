/**
 * 章节（view_points → ffmetadata 文件内容 + 中间文件命名）。
 * 语义对齐桌面 parse/additional/chapter.py：
 * - 每段 [CHAPTER]：TIMEBASE=1/1000、START/END 毫秒、title 转义（= ; # \\ 换行）；
 * - to <= from 时优先取下一段 from，末段用视频总时长兜底；仍无法确定则跳过该段；
 * - 章节文件仅作为 FFmpeg 合并的中间输入，合并成功后由调用方删除。
 */

export interface ViewPoint {
  from?: number;
  to?: number;
  content?: string;
}

/** ffmetadata 值转义（对齐上游 _escape：= ; # \\ 与换行前加反斜杠） */
export function escapeFfmetadataValue(content: string): string {
  let out = "";
  for (const ch of content) {
    out += ch === "=" || ch === ";" || ch === "#" || ch === "\\" || ch === "\n" ? `\\${ch}` : ch;
  }
  return out;
}

/** 章节中间文件名（对齐 ChapterParser.get_file_name：chapter_{task_id}.txt） */
export function chapterFileName(taskId: string): string {
  return `chapter_${taskId}.txt`;
}

/**
 * 生成 FFmpeg ffmetadata 章节文件内容。
 * @param viewPoints 播放器接口返回的分段章节（from/to 秒，可为小数）
 * @param fallbackEndSec 视频总时长（秒），末段 to 缺失/为 0 时兜底
 */
export function buildChapterFfmetadata(viewPoints: ViewPoint[], fallbackEndSec: number): string {
  const lines = [";FFMETADATA1", ""];
  for (let index = 0; index < viewPoints.length; index += 1) {
    const entry = viewPoints[index];
    if (!entry) continue;
    let start = Math.floor(entry.from ?? 0);
    let end = Math.floor(entry.to ?? 0);
    if (end <= start) {
      const next = viewPoints[index + 1];
      end = next !== undefined ? Math.floor(next.from ?? 0) : Math.floor(fallbackEndSec);
      if (end <= start) continue;
    }
    lines.push(
      "[CHAPTER]",
      "TIMEBASE=1/1000",
      `START=${start * 1000}`,
      `END=${end * 1000}`,
      `title=${escapeFfmetadataValue(entry.content ?? "")}`,
      "",
    );
  }
  return lines.join("\n");
}

/** 章节 ffmetadata 文件内容（buildChapterFfmetadata 别名） */
export function toChapterFfmetadata(viewPoints: ViewPoint[], fallbackEndSec: number): string {
  return buildChapterFfmetadata(viewPoints, fallbackEndSec);
}
