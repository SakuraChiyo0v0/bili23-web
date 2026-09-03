/**
 * FFmpeg 命令构造（语义对齐桌面 ffmpeg/command.py）。
 * 所有封装流程统一带 -strict unofficial：
 * 杜比视界的 dvcC/dvvC box 属于杜比自家规范，FFmpeg 默认合规级别会跳过，
 * 加上该参数无副作用（MKV 走 BlockAdditionMapping 不受影响）。
 */

/** 现代 DASH 视频+音频合并：双输入 -c copy（流拷贝，不做二次编码） */
export function buildMergeAudioVideo(videoPath: string, audioPath: string, outputPath: string): string[] {
  return [
    "ffmpeg", "-y",
    "-i", videoPath,
    "-i", audioPath,
    "-c:v", "copy",
    "-c:a", "copy",
    "-strict", "unofficial",
    outputPath,
  ];
}

/** 单输入流拷贝转封装（无音频的 m4s/mp4/flv → 目标容器） */
export function buildRemux(inputPath: string, outputPath: string): string[] {
  return ["ffmpeg", "-y", "-i", inputPath, "-c", "copy", "-strict", "unofficial", outputPath];
}

/** 旧版 flv/mp4 分片合并：concat demuxer 逐段流拷贝 */
export function buildConcatParts(listPath: string, outputPath: string): string[] {
  return [
    "ffmpeg", "-y",
    "-f", "concat", "-safe", "0",
    "-i", listPath,
    "-c", "copy",
    "-strict", "unofficial",
    outputPath,
  ];
}
