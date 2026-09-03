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

// ---------- 附加内容（封面 attach / 字幕轨 mux / 章节 ffmetadata）内嵌构造 ----------
// 语义对齐桌面 ffmpeg/command.py 的 add_cover / add_subtitles / add_chapter 与
// merger.py 的 merge_video_audio / merge_video_parts：封面为附加视频流（attached_pic）、
// ASS 字幕为独立字幕轨（仅 MKV）、章节用 ffmetadata 输入 + -map_chapters。

/** 待嵌入字幕轨（ASS 弹幕轨 kind=danmaku，ASS 字幕轨 kind=subtitle） */
export interface SubtitleTrackSpec {
  /** ASS 文件相对名/路径 */
  file: string;
  /** 轨标题（如 "中文" / "弹幕"） */
  title?: string;
  /** ISO 639-2 语言码（MKV Language 元素） */
  language?: string;
  kind: "subtitle" | "danmaku";
  /** 是否默认轨（打开视频即显示） */
  default?: boolean;
}

/** 合并时可附带的内嵌内容 */
export interface MergeExtras {
  /** 封面图片路径（attach 为 attached_pic 视频轨） */
  coverPath?: string;
  /** 章节 ffmetadata 中间文件路径 */
  chapterPath?: string;
  /** 待嵌入字幕轨列表（ASS），顺序即轨序 */
  subtitleTracks?: SubtitleTrackSpec[];
}

/**
 * DASH 音视频合并并附加封面/字幕轨/章节。
 * 与桌面一致：字幕输入必须排在封面之后（add_cover 的流映射写死封面输入索引）；
 * 无封面但带字幕时显式 -map 主流（否则 -map 出现后默认流选择失效会丢主流）。
 */
export function buildMergeAudioVideoEx(
  videoPath: string,
  audioPath: string,
  outputPath: string,
  extras: MergeExtras = {},
): string[] {
  const inputs: string[][] = [
    ["-i", videoPath],
    ["-i", audioPath],
  ];
  const params = ["-c:v", "copy", "-c:a", "copy", "-strict", "unofficial"];
  const tracks = extras.subtitleTracks ?? [];

  if (extras.coverPath !== undefined) {
    const coverIndex = inputs.length;
    inputs.push(["-i", extras.coverPath]);
    params.push("-map", "0:v:0", "-map", "1:a:0", "-map", `${coverIndex}:v:0`);
    params.push("-c:v:1", "png", "-disposition:v:1", "attached_pic", "-pix_fmt:v:1", "rgba");
  } else if (tracks.length > 0) {
    params.push("-map", "0:v:0", "-map", "1:a:0");
  }

  if (tracks.length > 0) {
    for (let index = 0; index < tracks.length; index += 1) {
      const track = tracks[index];
      if (!track) continue;
      const inputIndex = inputs.length;
      inputs.push(["-i", track.file]);
      params.push("-map", `${inputIndex}:s:0`);
      if (track.title !== undefined) params.push(`-metadata:s:s:${index}`, `title=${track.title}`);
      if (track.language !== undefined) {
        params.push(`-metadata:s:s:${index}`, `language=${track.language}`);
      }
      params.push(`-disposition:s:${index}`, track.default ? "default" : "0");
    }
    params.push("-c:s", "copy");
  }

  if (extras.chapterPath !== undefined) {
    const inputIndex = inputs.length;
    inputs.push(["-f", "ffmetadata", "-i", extras.chapterPath]);
    params.push("-map_chapters", String(inputIndex));
  }

  return ["ffmpeg", "-y", ...inputs.flat(), ...params, outputPath];
}

/** 旧版分片合并并附加封面/字幕轨/章节（音频用可选映射 0:a?，兼容无音轨分片） */
export function buildConcatPartsEx(
  listPath: string,
  outputPath: string,
  extras: MergeExtras = {},
): string[] {
  const inputs: string[][] = [["-f", "concat", "-safe", "0", "-i", listPath]];
  const params = ["-c:v", "copy", "-c:a", "copy", "-strict", "unofficial"];
  const tracks = extras.subtitleTracks ?? [];

  if (extras.coverPath !== undefined) {
    const coverIndex = inputs.length;
    inputs.push(["-i", extras.coverPath]);
    params.push("-map", "0:v:0", "-map", "0:a?", "-map", `${coverIndex}:v:0`);
    params.push("-c:v:1", "png", "-disposition:v:1", "attached_pic", "-pix_fmt:v:1", "rgba");
  } else if (tracks.length > 0) {
    params.push("-map", "0:v:0", "-map", "0:a?");
  }

  if (tracks.length > 0) {
    for (let index = 0; index < tracks.length; index += 1) {
      const track = tracks[index];
      if (!track) continue;
      const inputIndex = inputs.length;
      inputs.push(["-i", track.file]);
      params.push("-map", `${inputIndex}:s:0`);
      if (track.title !== undefined) params.push(`-metadata:s:s:${index}`, `title=${track.title}`);
      if (track.language !== undefined) {
        params.push(`-metadata:s:s:${index}`, `language=${track.language}`);
      }
      params.push(`-disposition:s:${index}`, track.default ? "default" : "0");
    }
    params.push("-c:s", "copy");
  }

  if (extras.chapterPath !== undefined) {
    const inputIndex = inputs.length;
    inputs.push(["-f", "ffmetadata", "-i", extras.chapterPath]);
    params.push("-map_chapters", String(inputIndex));
  }

  return ["ffmpeg", "-y", ...inputs.flat(), ...params, outputPath];
}
