import type { CoverFormat } from "./types.js";
import { coverDownloadUrl, fetchCoverBytes } from "./fetch.js";

/**
 * 封面处理（语义对齐桌面 parse/additional/cover.py + merger 的封面 attach）：
 * - 下载走 B 站图床 `@{format}` 转码（fetchCoverBytes/coverDownloadUrl，见 fetch.ts）；
 * - ffmpeg 命令构造：本地转码（buildCoverConvertArgs）与向已合并媒体附加封面轨
 *   （buildAttachCoverToMedia），供上层管线在需要时使用。
 */

export { coverDownloadUrl, fetchCoverBytes };

/** 封面文件名 = 主文件 stem + "." + 格式（封面无限定词，对齐 base._write 无 qualifier 调用） */
export function coverFileName(stem: string, format: CoverFormat): string {
  return `${stem}.${format}`;
}

/** 目标格式 → ffmpeg 图像编码器 */
function coverEncoder(format: CoverFormat): string {
  switch (format) {
    case "jpg":
      return "mjpeg";
    case "png":
      return "png";
    case "webp":
      return "libwebp";
    case "avif":
      return "libsvtav1";
  }
}

/**
 * 用 ffmpeg 把图片转码为指定格式（CDN @{format} 不可用/需要本地归一化时的回退路径）。
 * avif 依赖带 libsvtav1/libavif 的 ffmpeg 构建，编码器不可用会以非零码退出。
 */
export function buildCoverConvertArgs(
  inputPath: string,
  outputPath: string,
  format: CoverFormat,
): string[] {
  return ["ffmpeg", "-y", "-i", inputPath, "-c:v", coverEncoder(format), "-frames:v", "1", outputPath];
}

/**
 * 向已合并媒体附加封面轨（attached_pic），适合“合并完成后”的管线调用。
 * 语义对齐桌面 FFmpegCommand.add_cover：封面编码为 png、disposition=attached_pic、pix_fmt=rgba；
 * 封面不能通过 mp4/mkv 的 mux 步骤时（例如输入本身就是完整媒体）可先 remux 再 attach。
 */
export function buildAttachCoverToMedia(
  mediaPath: string,
  coverPath: string,
  outputPath: string,
): string[] {
  return [
    "ffmpeg", "-y",
    "-i", mediaPath,
    "-i", coverPath,
    "-map", "0",
    "-map", "1:v:0",
    "-c", "copy",
    "-c:v:1", "png",
    "-disposition:v:1", "attached_pic",
    "-pix_fmt:v:1", "rgba",
    "-strict", "unofficial",
    outputPath,
  ];
}
