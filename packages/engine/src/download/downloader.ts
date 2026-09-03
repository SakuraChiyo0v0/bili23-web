import { open, mkdir } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { BiliError } from "../errors.js";
import type { HttpClient } from "../api/http.js";
import type { SpeedGate } from "./rate.js";

/**
 * 分块并发下载器（语义对齐桌面 download/downloader.py）。
 * - 把文件按 chunk_size（默认 4MiB）切成多个 Range 分片并发拉取；
 * - 每片独立重试（网络/5xx/429），断点按“已确认落盘字节”记录，支持暂停续传；
 * - 令牌桶限速；进度按已确认落盘字节上报，单调不回退。
 * Node 单线程事件循环天然等价于桌面锁保护的关键区，因此无需线程锁。
 */

/** 调用方主动中止（暂停/取消），不应记为失败 */
export class DownloadAbortedError extends Error {
  constructor(message = "下载已被中止") {
    super(message);
    this.name = "DownloadAbortedError";
  }
}

export const DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024;
export const DEFAULT_FLUSH_INTERVAL = 1024 * 1024;
export const DEFAULT_MAX_CHUNK_RETRIES = 5;
export const DEFAULT_CONCURRENCY = 4;
export const DEFAULT_CHUNK_TIMEOUT_MS = 180_000;
export const DEFAULT_READ_INACTIVITY_MS = 60_000;

/** 可重试状态码（对齐桌面 ChunkWorker.retryable_status_codes） */
export const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
/** 不可重试状态码（对齐桌面 permanent_status_codes） */
export const PERMANENT_STATUS_CODES = new Set([400, 401, 403, 404, 405, 410, 416]);
/** 可重试/不可重试的文件系统错误码（桌面 errno 集合的语义翻译） */
export const RETRYABLE_FS_CODES = new Set([
  "EAGAIN", "EWOULDBLOCK", "EINTR", "ETIMEDOUT", "ECONNRESET",
  "ECONNABORTED", "ECONNREFUSED", "ENETDOWN", "ENETUNREACH", "EHOSTUNREACH", "EPIPE",
]);
export const PERMANENT_FS_CODES = new Set(["EACCES", "EPERM", "ENOENT", "ENOSPC", "EROFS", "EISDIR", "ENOTDIR"]);

/** HTTP 状态码是否可重试（对齐桌面 _is_retryable_exception） */
export function isRetryableStatus(status: number): boolean {
  if (PERMANENT_STATUS_CODES.has(status)) return false;
  if (RETRYABLE_STATUS_CODES.has(status)) return true;
  return status >= 500;
}

/** 文件系统错误码是否可重试 */
export function isRetryableFsCode(code: string | undefined): boolean {
  if (!code) return false;
  if (PERMANENT_FS_CODES.has(code)) return false;
  if (RETRYABLE_FS_CODES.has(code)) return true;
  return false;
}

/**
 * 判断一次下载尝试抛出的错误是否可重试：
 * fetch 网络失败（TypeError）、自身中止产生的 AbortError、BiliError(NETWORK)、可重试 fs 错误 → true。
 */
export function isRetryableError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  if (err instanceof DOMException && err.name === "AbortError") return true;
  if (err instanceof BiliError && err.code === "NETWORK") return true;
  if (typeof err === "object" && err !== null && "code" in err) {
    return isRetryableFsCode((err as { code?: unknown }).code as string | undefined);
  }
  return false;
}

/** 令牌桶：平滑限制下载速度（对齐桌面 TokenBucket；单线程无需锁） */
export class TokenBucket {
  /** 字节/秒；0 表示不限速 */
  rate: number;
  #tokens: number;
  #lastUpdate: number;

  constructor(rate = 0) {
    this.rate = Math.max(rate, 0);
    this.#tokens = this.rate;
    this.#lastUpdate = Date.now();
  }

  /** 消耗 amount 字节；令牌不足按速率休眠补齐，可被 signal 中断（对齐桌面 TokenBucket） */
  async consume(amount: number, signal?: AbortSignal): Promise<void> {
    if (this.rate <= 0 || amount <= 0) return;
    const now = Date.now();
    const elapsed = (now - this.#lastUpdate) / 1000;
    this.#lastUpdate = now;
    this.#tokens = Math.min(this.rate, this.#tokens + elapsed * this.rate);
    this.#tokens -= amount;
    if (this.#tokens < 0) {
      const waitMs = (-this.#tokens / this.rate) * 1000;
      await sleepInterruptible(waitMs, signal);
    }
  }

  setRate(rate: number): void {
    this.rate = Math.max(rate, 0);
    this.#tokens = this.rate;
    this.#lastUpdate = Date.now();
  }
}

export interface ProbeOptions {
  /** 低于该字节数的候选视为无效，默认 1024 */
  minFileSize?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ProbeResult {
  /** 探测可用且大小有效的下载地址 */
  url: string;
  fileSize: number;
}

/** 分片断点状态：键统一用字符串（对齐桌面断点表随任务快照走 JSON） */
export interface ChunkState {
  totalChunks: number;
  /** chunkIndex → 已确认落盘字节数（≤ 该分片长度） */
  offsets: Record<string, number>;
}

export interface DownloadProgress {
  /** 已确认落盘字节（单调） */
  downloadedBytes: number;
  totalBytes: number;
}

export interface DownloadFileOptions {
  http: HttpClient;
  /** 已解析可用的下载地址 */
  url: string;
  /** 目标临时文件完整路径（父目录自动创建） */
  destPath: string;
  /** 期望文件总大小（由探测得到） */
  fileSize: number;
  /** 分片大小，默认 4MiB */
  chunkSize?: number;
  /** 并发分片数，默认 4（对齐桌面 download_thread） */
  concurrency?: number;
  /** 单分片最大重试次数，默认 5 */
  maxRetries?: number;
  /** 限速（字节/秒），0 不限，默认 0 */
  rateLimitBps?: number;
  /** 共享限速门（跨调用/任务共享、可即时调整）；有 gate 时优先于 rateLimitBps */
  gate?: SpeedGate;
  /** 取流 Referer（CDN 校验来源），缺省用 http 默认 */
  referer?: string;
  /** 单次分片请求超时（毫秒），默认 180s */
  timeoutMs?: number;
  /** 读取流无数据超时（毫秒），默认 60s */
  readInactivityMs?: number;
  /** 断点快照；传入则续传并原地更新 */
  state?: ChunkState;
  /** 用户中止（暂停/取消） */
  signal?: AbortSignal;
  /** 进度回调（按已确认落盘字节） */
  onProgress?: (progress: DownloadProgress) => void;
  /** 断点快照变更回调（调用方持久化用） */
  onSnapshot?: (state: ChunkState) => void;
}

export interface DownloadFileResult {
  url: string;
  fileSize: number;
  /** 最终确认落盘字节（= fileSize） */
  downloadedBytes: number;
  state: ChunkState;
}

/** 分片级“应重试”的内部信号（HTTP 可重试状态、Range 被忽略、流提前结束等） */
class RetryableChunkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableChunkError";
  }
}

/** 分片实际已完成（如 416），须在文件关闭收尾后再统一标记完成 */
class ChunkDoneSignal extends Error {
  constructor() {
    super("chunk done");
    this.name = "ChunkDoneSignal";
  }
}

function chunkLength(index: number, chunkSize: number, fileSize: number): number {
  const start = index * chunkSize;
  return Math.min(start + chunkSize, fileSize) - start;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

async function sleepInterruptible(ms: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DownloadAbortedError());
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DownloadAbortedError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** 对读取施加“无数据超时”：超时中止本次请求并抛可重试错误 */
async function withInactivityTimeout<T>(task: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  if (ms <= 0) return task;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(new RetryableChunkError("读取数据超时"));
    }, ms);
  });
  try {
    return await Promise.race([task, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function writeAll(handle: FileHandle, data: Uint8Array, position: number): Promise<void> {
  let written = 0;
  while (written < data.length) {
    const { bytesWritten } = await handle.write(data, written, data.length - written, position + written);
    if (bytesWritten <= 0) throw new Error("写入文件失败：未写入任何字节");
    written += bytesWritten;
  }
}

/**
 * 从候选链接解析可用下载地址与真实大小（语义对齐桌面 network/download_url.py）。
 * 依次尝试候选（同 host 只试一次）：HEAD → 大小有效即返回；
 * 被拒（405）或大小无效时改用 Range GET 探测。
 */
export async function probeStreamUrl(
  http: HttpClient,
  candidates: string[],
  opts: ProbeOptions = {},
): Promise<ProbeResult> {
  const minFileSize = opts.minFileSize ?? 1024;
  const seen = new Set<string>();
  for (const url of candidates) {
    if (!url) continue;
    const host = hostOf(url);
    if (seen.has(host)) continue;
    seen.add(host);
    try {
      const size = await probeOne(http, url, minFileSize, opts);
      if (size > minFileSize) {
        return { url, fileSize: size };
      }
    } catch {
      // 该候选失败，继续下一个
    }
  }
  throw new BiliError("DOWNLOAD_FAILED", "无法获取有效的下载链接（接口未返回任何可用链接）");
}

async function probeOne(http: HttpClient, url: string, minFileSize: number, opts: ProbeOptions): Promise<number> {
  const timeoutMs = opts.timeoutMs ?? 10_000;

  const requestOptions = {
    retries: 1,
    timeoutMs,
    ...(opts.signal ? { signal: opts.signal } : {}),
  };
  const response = await http.request("HEAD", url, requestOptions);
  const headSize = extractFileSize(response.headers);
  await response.body?.cancel().catch(() => undefined);
  if (response.status === 405 || !response.ok || headSize <= minFileSize) {
    return probeWithRange(http, url, minFileSize, opts);
  }
  return headSize;
}

async function probeWithRange(http: HttpClient, url: string, minFileSize: number, opts: ProbeOptions): Promise<number> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const response = await http.request("GET", url, {
    headers: { Range: "bytes=0-0" },
    retries: 1,
    timeoutMs,
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  // 只取响应头（Content-Range/Content-Length），不读 body
  const size = extractFileSize(response.headers);
  await response.body?.cancel().catch(() => undefined);
  if (response.ok && size > minFileSize) return size;
  throw new BiliError("DOWNLOAD_FAILED", `候选链接探测失败：HTTP ${response.status}`);
}

/** 从响应头提取文件总大小（对齐桌面 _extract_file_size） */
export function extractFileSize(headers: Headers): number {
  const contentType = (headers.get("content-type") ?? "").toLowerCase();
  if (!contentType || contentType.includes("text") || contentType.includes("json")) return 0;

  const contentRange = headers.get("content-range") ?? "";
  const total = contentRange.slice(contentRange.lastIndexOf("/") + 1).trim();
  if (/^\d+$/.test(total)) return Number(total);

  const contentLength = headers.get("content-length") ?? "";
  if (/^\d+$/.test(contentLength)) return Number(contentLength);
  return 0;
}

function dirnameOf(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut <= 0 ? "." : path.slice(0, cut);
}

async function ensureFileSize(path: string, size: number): Promise<void> {
  let handle: FileHandle;
  try {
    handle = await open(path, "r+");
  } catch {
    handle = await open(path, "w");
    await handle.close();
    handle = await open(path, "r+");
  }
  try {
    const stat = await handle.stat();
    if (stat.size !== size) {
      await handle.truncate(size);
    }
  } finally {
    await handle.close();
  }
}

/**
 * 下载单个文件：按 Range 分片并发拉取，支持断点续传、重试与限速。
 * 成功返回下载结果；被 signal 中止抛 DownloadAbortedError；失败抛 BiliError(DOWNLOAD_FAILED)。
 */
export async function downloadFile(options: DownloadFileOptions): Promise<DownloadFileResult> {
  const {
    http, url, destPath, fileSize, referer, signal, onProgress, onSnapshot,
  } = options;
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  const maxRetries = Math.max(1, options.maxRetries ?? DEFAULT_MAX_CHUNK_RETRIES);
  const timeoutMs = options.timeoutMs ?? DEFAULT_CHUNK_TIMEOUT_MS;
  const readInactivityMs = options.readInactivityMs ?? DEFAULT_READ_INACTIVITY_MS;

  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    throw new BiliError("DOWNLOAD_FAILED", "下载失败：文件大小无效");
  }

  await mkdir(dirnameOf(destPath), { recursive: true });
  await ensureFileSize(destPath, fileSize);
  if (signal?.aborted) throw new DownloadAbortedError();

  const totalChunks = Math.max(1, Math.ceil(fileSize / chunkSize));
  const state: ChunkState = { totalChunks, offsets: {} };
  let committedTotal = 0;
  for (let i = 0; i < totalChunks; i += 1) {
    const len = chunkLength(i, chunkSize, fileSize);
    const prev =
      options.state?.totalChunks === totalChunks ? Number(options.state.offsets[String(i)] ?? 0) : 0;
    const offset = clamp(Math.floor(prev), 0, len);
    state.offsets[String(i)] = offset;
    committedTotal += offset;
  }

  // 有共享 gate 用 gate（跨任务共享限速），否则保留 rateLimitBps 自建桶行为（旧调用不回归）
  const gate = options.gate;
  const bucket = gate === undefined ? new TokenBucket(options.rateLimitBps ?? 0) : undefined;
  const innerAbort = new AbortController();
  const combinedSignal = AbortSignal.any([innerAbort.signal, ...(signal ? [signal] : [])]);
  let firstError: unknown = null;
  let nextChunk = 0;

  const emitSnapshot = (): void => onSnapshot?.(state);
  const emitProgress = (): void => onProgress?.({ downloadedBytes: committedTotal, totalBytes: fileSize });
  const commitOffset = (index: number, offset: number): void => {
    const len = chunkLength(index, chunkSize, fileSize);
    const capped = clamp(offset, 0, len);
    const key = String(index);
    const delta = capped - (state.offsets[key] ?? 0);
    if (delta !== 0) {
      state.offsets[key] = capped;
      committedTotal += delta;
    }
  };
  const markChunkFinished = (index: number): void => {
    commitOffset(index, chunkLength(index, chunkSize, fileSize));
    emitSnapshot();
    emitProgress();
  };

  const downloadChunk = async (index: number): Promise<void> => {
    const start = index * chunkSize;
    const len = chunkLength(index, chunkSize, fileSize);
    if (len <= 0) {
      markChunkFinished(index);
      return;
    }
    let written = state.offsets[String(index)] ?? 0;
    if (written >= len) {
      markChunkFinished(index);
      return;
    }

    for (let attempt = 0; attempt < maxRetries; attempt += 1) {
      if (combinedSignal.aborted) throw new DownloadAbortedError();
      if (written >= len) break;

      const attemptAbort = new AbortController();
      const attemptSignal = AbortSignal.any([combinedSignal, attemptAbort.signal]);
      let handle: FileHandle | undefined;
      let downloaded = 0;
      let pending = 0;
      let expected = 0;

      try {
        try {
          handle = await open(destPath, "r+");
          const rangeStart = start + written;
          const rangeEnd = start + len - 1; // Range 头为闭区间
          const headers: Record<string, string> = { Range: `bytes=${rangeStart}-${rangeEnd}` };
          if (referer) headers.Referer = referer;
          const response = await http.request("GET", url, {
            headers,
            retries: 0,
            timeoutMs,
            signal: attemptSignal,
          });
          if (combinedSignal.aborted) throw new DownloadAbortedError();

          if (response.status === 416) {
            await response.body?.cancel().catch(() => undefined);
            // 续传进度已存在时，416 表示本片其实已写满，按完成处理
            if (written > 0) throw new ChunkDoneSignal();
            throw new BiliError("DOWNLOAD_FAILED", `分片 ${index + 1} 返回 416（区间无效）`);
          }
          if (!response.ok) {
            await response.body?.cancel().catch(() => undefined);
            if (!isRetryableStatus(response.status)) {
              throw new BiliError("DOWNLOAD_FAILED", `分片 ${index + 1} 请求返回 HTTP ${response.status}`);
            }
            throw new RetryableChunkError(`HTTP ${response.status}`);
          }
          if (written > 0 && response.status !== 206) {
            // 服务端忽略 Range：续传位置无从谈起，整片从头重下
            await response.body?.cancel().catch(() => undefined);
            commitOffset(index, 0);
            written = 0;
            emitSnapshot();
            emitProgress();
            throw new RetryableChunkError("服务端未按 Range 返回 206，分片将从头重新下载");
          }

          const contentLength = Number(response.headers.get("content-length") ?? "0");
          expected =
            Number.isFinite(contentLength) && contentLength > 0 ? contentLength : len - written;

          const reader = response.body?.getReader();
          if (!reader) throw new RetryableChunkError("响应没有可读的 body");

          for (;;) {
            const result = await withInactivityTimeout(reader.read(), readInactivityMs, () =>
              attemptAbort.abort(),
            );
            if (result.done) break;
            const value = result.value;
            if (!value || value.length === 0) continue;
            if (combinedSignal.aborted) throw new DownloadAbortedError();
            if (gate !== undefined) {
              await gate.take(value.length, combinedSignal);
            } else if (bucket !== undefined) {
              await bucket.consume(value.length, combinedSignal);
            }
            await writeAll(handle, value, start + written + pending);
            downloaded += value.length;
            pending += value.length;
            if (pending >= DEFAULT_FLUSH_INTERVAL) {
              written += pending;
              pending = 0;
              commitOffset(index, written);
              emitSnapshot();
              emitProgress();
            }
          }
          await reader.cancel().catch(() => undefined);
        } finally {
          // 无论正常结束还是中途抛错都先关闭文件：关闭成功即代表本轮写入已落盘，
          // 可计入断点；失败则丢弃本轮未确认数据（对齐桌面 finally 语义）
          if (handle) {
            let closeOk = true;
            try {
              await handle.close();
            } catch {
              closeOk = false;
            }
            handle = undefined;
            if (closeOk) {
              written += pending;
              pending = 0;
              commitOffset(index, written);
              emitSnapshot();
              emitProgress();
            } else {
              pending = 0;
            }
          }
        }
        // 走到这里说明本轮请求没有抛错且文件已关闭
        if (combinedSignal.aborted) throw new DownloadAbortedError();
        if (downloaded >= expected) {
          markChunkFinished(index);
          return;
        }
        throw new RetryableChunkError(
          `分片 ${index + 1} 提前结束（期望 ${expected}，实际 ${downloaded}），触发重试`,
        );
      } catch (err) {
        if (combinedSignal.aborted) throw new DownloadAbortedError();
        if (err instanceof ChunkDoneSignal) {
          markChunkFinished(index);
          return;
        }
        if (err instanceof RetryableChunkError || isRetryableError(err)) {
          if (attempt + 1 >= maxRetries) {
            throw new BiliError("DOWNLOAD_FAILED", `分片 ${index + 1} 下载失败，已尝试 ${maxRetries} 次仍未成功`, {
              cause: err,
            });
          }
          const backoffMs = Math.min(2 ** attempt, 8) * 1000;
          await sleepInterruptible(backoffMs, combinedSignal);
          continue;
        }
        throw err instanceof BiliError
          ? err
          : new BiliError("DOWNLOAD_FAILED", `分片 ${index + 1} 下载失败：${String(err)}`, { cause: err });
      }
    }
    // 理论不可达：重试耗尽会直接 throw；此处兜底
    if (written >= chunkLength(index, chunkSize, fileSize)) {
      markChunkFinished(index);
      return;
    }
    throw new BiliError("DOWNLOAD_FAILED", `分片 ${index + 1} 未能完成下载`);
  };

  const workerCount = Math.min(concurrency, totalChunks);
  const workers: Promise<void>[] = [];
  for (let w = 0; w < workerCount; w += 1) {
    workers.push(
      (async () => {
        for (;;) {
          const index = nextChunk;
          nextChunk += 1;
          if (index >= totalChunks || combinedSignal.aborted) break;
          try {
            await downloadChunk(index);
          } catch (err) {
            // 用户中止或另一分片失败触发的内部中止：统一在此退出
            if (combinedSignal.aborted) break;
            if (firstError === null) {
              firstError = err;
              innerAbort.abort();
            }
            break;
          }
        }
      })(),
    );
  }
  await Promise.all(workers);

  if (firstError !== null) throw firstError;
  if (signal?.aborted) throw new DownloadAbortedError();

  emitProgress();
  return { url, fileSize, downloadedBytes: committedTotal, state };
}

