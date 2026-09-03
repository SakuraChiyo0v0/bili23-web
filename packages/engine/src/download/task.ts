import { join } from "node:path";
import { BiliError } from "../errors.js";
import type { HttpClient } from "../api/http.js";
import { DownloadAbortedError, downloadFile, probeStreamUrl } from "./downloader.js";
import type { ChunkState } from "./downloader.js";

/**
 * 文件级下载计划执行器。
 * 一个媒体条目（投稿视频）通常由 video(+audio) 或 MP4 直链分片组成，
 * 桌面版按 download_queue 逐文件串行下载（每次只处理 queue[0]），本模块保持同样语义：
 * 文件间串行，文件内分片并发。
 */

/** 任务状态（命名对齐桌面 DownloadStatus 枚举的语义） */
export type DownloadStatus =
  | "queued"
  | "parsing"
  | "downloading"
  | "paused"
  | "completed"
  | "merging"
  | "failed"
  | "cancelled";

/** 计划中的一个待下载文件 */
export interface DownloadTaskFile {
  /** 稳定键：video / audio / video_part_{index}（对齐桌面 file_key） */
  key: string;
  /** 候选下载地址（首选在前），探测后取第一个可用 */
  urls: string[];
  /** 相对下载根目录的文件名（临时文件名，合并后另行命名） */
  relativeName: string;
}

export interface RunPlanOptions {
  http: HttpClient;
  /** 下载根目录（临时文件写入 <root>/<relativeName>） */
  rootDir: string;
  files: DownloadTaskFile[];
  /** 每文件分片并发，默认 4 */
  concurrency?: number;
  /** 分片大小，默认 4MiB */
  chunkSize?: number;
  /** 限速（字节/秒），默认不限 */
  rateLimitBps?: number;
  /** 取流 Referer */
  referer?: string;
  /** 用户中止（暂停/取消） */
  signal?: AbortSignal;
  /** 断点快照（file key → 分片状态），续传用并原地更新 */
  resume?: Record<string, ChunkState>;
  /** 单文件开始下载（探测完成） */
  onFileStart?: (fileKey: string, info: { url: string; fileSize: number }) => void;
  /** 单文件进度（已确认落盘字节） */
  onFileProgress?: (fileKey: string, progress: { downloadedBytes: number; totalBytes: number }) => void;
  /** 单文件断点快照变更（调用方持久化） */
  onFileSnapshot?: (fileKey: string, state: ChunkState) => void;
  /** 单文件下载完成 */
  onFileDone?: (fileKey: string) => void;
}

export interface RunPlanResult {
  /** 每个文件的最终信息（key → 结果） */
  files: Record<string, { url: string; fileSize: number; downloadedBytes: number }>;
}

/** 逐文件执行下载计划；中途被中止抛 DownloadAbortedError，失败抛 BiliError(DOWNLOAD_FAILED) */
export async function runDownloadPlan(options: RunPlanOptions): Promise<RunPlanResult> {
  const {
    http, rootDir, files, referer, signal,
    onFileStart, onFileProgress, onFileSnapshot, onFileDone,
  } = options;
  const concurrency = options.concurrency;
  const chunkSize = options.chunkSize;
  const rateLimitBps = options.rateLimitBps;
  const resume = options.resume ?? {};

  const result: RunPlanResult["files"] = {};

  for (const file of files) {
    if (signal?.aborted) throw new DownloadAbortedError();

    // 每个文件先探测候选，取得可用地址与真实大小（桌面 QueryWorker/resolve_download_url 语义）
    const { url, fileSize } = await probeStreamUrl(http, file.urls, signal ? { signal } : {});

    if (onFileStart) onFileStart(file.key, { url, fileSize });

    const destPath = join(rootDir, file.relativeName);
    const downloadOptions: Parameters<typeof downloadFile>[0] = { http, url, destPath, fileSize };
    if (concurrency !== undefined) downloadOptions.concurrency = concurrency;
    if (chunkSize !== undefined) downloadOptions.chunkSize = chunkSize;
    if (rateLimitBps !== undefined) downloadOptions.rateLimitBps = rateLimitBps;
    if (referer !== undefined) downloadOptions.referer = referer;
    if (signal !== undefined) downloadOptions.signal = signal;
    const snapshot = resume[file.key];
    if (snapshot !== undefined) downloadOptions.state = snapshot;
    downloadOptions.onProgress = (progress) => onFileProgress?.(file.key, progress);
    downloadOptions.onSnapshot = (s) => {
      resume[file.key] = s;
      onFileSnapshot?.(file.key, s);
    };
    let fileResult: Awaited<ReturnType<typeof downloadFile>> | undefined;
    try {
      fileResult = await downloadFile(downloadOptions);
    } catch (err) {
      if (err instanceof DownloadAbortedError) throw err;
      if (err instanceof BiliError) throw err;
      throw new BiliError("DOWNLOAD_FAILED", `文件 ${file.relativeName} 下载失败：${String(err)}`, {
        cause: err,
      });
    }

    if (!fileResult) throw new Error("unreachable: downloadFile 未返回结果");
    resume[file.key] = fileResult.state;
    result[file.key] = { url, fileSize, downloadedBytes: fileResult.downloadedBytes };
    if (onFileDone) onFileDone(file.key);
  }

  return { files: result };
}



