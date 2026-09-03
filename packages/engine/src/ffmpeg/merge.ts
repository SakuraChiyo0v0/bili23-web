import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { BiliError } from "../errors.js";
import {
  buildConcatParts,
  buildConcatPartsEx,
  buildMergeAudioVideo,
  buildMergeAudioVideoEx,
  buildRemux,
} from "./command.js";
import type { MergeExtras, SubtitleTrackSpec } from "./command.js";
import { runFfmpeg } from "./runner.js";
import type { FfmpegRunOptions } from "./runner.js";

/**
 * 高层的 ffmpeg 合并/转封装与媒体探测。
 * 语义对齐桌面 downloader/merger.py：DASH 视频+音频拷贝合并；
 * 无音频时单输入拷贝转封装；旧版分片用 concat。出错统一映射为 MERGE_FAILED。
 * MergeOptions 附带封面/字幕轨/章节内嵌（对齐 Merger.check_attach_cover /
 * check_embed_subtitles / check_attach_chapter）。
 */

export { buildMergeAudioVideoEx, buildConcatPartsEx };
export type { MergeExtras, SubtitleTrackSpec };

export interface MergeOptions {
  /** 输出容器（决定扩展名语义与字幕轨内嵌可用性），默认 mp4 */
  container?: "mp4" | "mkv";
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
  cwd?: string;
  /** 封面图片路径（存在则作为 attached_pic 嵌入，桌面 attach_cover） */
  coverPath?: string;
  /** 章节 ffmetadata 中间文件路径（存在则写入章节，桌面 embed_chapter） */
  chapterPath?: string;
  /** 待嵌入 ASS 字幕轨（仅容器为 mkv 时生效；字幕轨排在弹幕轨前并默认显示第一条字幕） */
  subtitleTracks?: SubtitleTrackSpec[];
}

export interface MergeResult {
  outputPath: string;
  code: number;
  stderr: string;
}

function toRunOptions(opts: MergeOptions): FfmpegRunOptions {
  const run: FfmpegRunOptions = {};
  if (opts.cwd !== undefined) run.cwd = opts.cwd;
  if (opts.onProgress) run.onProgress = opts.onProgress;
  if (opts.signal) run.signal = opts.signal;
  return run;
}

function throwOnFailure(code: number, stderr: string, action: string): void {
  if (code !== 0) {
    const tail = stderr.trim().split("\n").slice(-10).join("\n");
    throw new BiliError("MERGE_FAILED", `${action}失败（退出码 ${code}）：${tail || "无错误输出"}`);
  }
}

/**
 * 合并时可用的内嵌内容（封面/章节/字幕）。
 * 桌面只在存在合并步骤时内嵌，且 ASS 字幕轨仅 MKV 支持；这里把解析阶段登记好的
 * 封面/章节/字幕文件原样转交命令构造。
 */
function collectExtras(opts: MergeOptions): MergeExtras {
  const extras: MergeExtras = {};
  const cwd = opts.cwd ?? ".";
  if (opts.coverPath !== undefined && existsSync(join(cwd, opts.coverPath))) {
    extras.coverPath = opts.coverPath;
  }
  if (opts.chapterPath !== undefined && existsSync(join(cwd, opts.chapterPath))) {
    extras.chapterPath = opts.chapterPath;
  }
  const tracks = resolveEmbeddableTracks(opts);
  if (tracks.length > 0) extras.subtitleTracks = tracks;
  return extras;
}

/**
 * 过滤/排序待嵌入字幕轨（对齐桌面 Merger.check_embed_subtitles）：
 * - 仅输出 MKV 才内嵌；跳过错文件；
 * - 字幕轨排在弹幕轨之前（稳定排序），首条字幕轨标记 default（打开视频即显示字幕）。
 */
function resolveEmbeddableTracks(opts: MergeOptions): SubtitleTrackSpec[] {
  if (opts.container !== "mkv" || opts.subtitleTracks === undefined) return [];
  const cwd = opts.cwd ?? ".";
  const tracks: SubtitleTrackSpec[] = [];
  for (const track of opts.subtitleTracks) {
    if (existsSync(join(cwd, track.file))) {
      tracks.push({ ...track });
    }
  }
  if (tracks.length === 0) return [];
  tracks.sort((a, b) => (a.kind === "subtitle" ? 0 : 1) - (b.kind === "subtitle" ? 0 : 1));
  if (tracks[0]?.kind === "subtitle") {
    tracks[0] = { ...tracks[0], default: true };
  }
  return tracks;
}

function hasExtras(opts: MergeOptions): boolean {
  return (
    opts.coverPath !== undefined ||
    opts.chapterPath !== undefined ||
    opts.subtitleTracks !== undefined
  );
}

/** DASH 视频+音频拷贝合并（可含仅视频场景的封装，见 remuxMedia） */
export async function mergeAudioVideo(
  videoPath: string,
  audioPath: string,
  outputPath: string,
  opts: MergeOptions = {},
): Promise<MergeResult> {
  const argv = hasExtras(opts)
    ? buildMergeAudioVideoEx(videoPath, audioPath, outputPath, collectExtras(opts))
    : buildMergeAudioVideo(videoPath, audioPath, outputPath);
  const result = await runFfmpeg(argv, toRunOptions(opts));
  throwOnFailure(result.code, result.stderr, "音视频合并");
  return { outputPath, code: result.code, stderr: result.stderr };
}

/** 单输入流拷贝转封装（下载了视频流但没有音频/已带音频的直链时使用） */
export async function remuxMedia(
  inputPath: string,
  outputPath: string,
  opts: MergeOptions = {},
): Promise<MergeResult> {
  const result = await runFfmpeg(buildRemux(inputPath, outputPath), toRunOptions(opts));
  throwOnFailure(result.code, result.stderr, "转封装");
  return { outputPath, code: result.code, stderr: result.stderr };
}

/** 旧版 flv/mp4 分片合并（concat demuxer） */
export async function concatMediaParts(
  listPath: string,
  outputPath: string,
  opts: MergeOptions = {},
): Promise<MergeResult> {
  const argv = hasExtras(opts)
    ? buildConcatPartsEx(listPath, outputPath, collectExtras(opts))
    : buildConcatParts(listPath, outputPath);
  const result = await runFfmpeg(argv, toRunOptions(opts));
  throwOnFailure(result.code, result.stderr, "分片合并");
  return { outputPath, code: result.code, stderr: result.stderr };
}

export interface ProbeStream {
  index: number;
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  duration?: string;
}

export interface ProbeInfo {
  /** 媒体时长（秒），缺失时 undefined */
  duration?: number;
  streams: ProbeStream[];
}

/** 用 ffprobe 探测媒体文件（E2E 校验产物可播/结构用） */
export async function probeMedia(filePath: string): Promise<ProbeInfo> {
  const args = [
    "ffprobe",
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    filePath,
  ];
  const result = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(args[0] as string, args.slice(1), { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
    child.stderr?.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
    child.once("error", (err) =>
      reject(new BiliError("MERGE_FAILED", `无法启动 ffprobe：${String(err)}`, { cause: err })),
    );
    child.once("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });

  if (result.code !== 0) {
    throw new BiliError("MERGE_FAILED", `媒体探测失败（退出码 ${result.code}）：${result.stderr.trim()}`);
  }
  try {
    const json = JSON.parse(result.stdout) as {
      format?: { duration?: string };
      streams?: ProbeStream[];
    };
    const info: ProbeInfo = { streams: json.streams ?? [] };
    if (json.format?.duration) {
      const duration = Number(json.format.duration);
      if (Number.isFinite(duration)) info.duration = duration;
    }
    return info;
  } catch (err) {
    throw new BiliError("MERGE_FAILED", `媒体探测输出无法解析`, { cause: err });
  }
}
