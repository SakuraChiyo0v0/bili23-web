import { spawn } from "node:child_process";
import { BiliError } from "../errors.js";

/**
 * FFmpeg 子进程执行器（语义对齐桌面 ffmpeg/runner.py）。
 * - 全局参数紧跟可执行文件：-progress pipe:1（机器可读进度写 stdout）、-nostats（关闭 stderr 进度刷屏）；
 * - 从 stderr 解析各输入中最长的 Duration，用 out_time_us 换算 0-100 进度；
 * - stdout/stderr 只保留尾部，避免大日志撑爆内存；
 * - 支持 signal 中止（kill 子进程）。
 */

const STDERR_KEEP_LINES = 500;
const STDOUT_KEEP_LINES = 40;

const DURATION_PATTERN = /Duration:\s*(\d+):(\d{2}):(\d{2})\.(\d+)/g;
const PROGRESS_TIME_KEY = "out_time_us=";

export interface FfmpegRunOptions {
  cwd?: string;
  /** 0-100 合并进度 */
  onProgress?: (percent: number) => void;
  /** 中止信号（暂停/取消） */
  signal?: AbortSignal;
  /** 进程超时（毫秒），默认 10 分钟 */
  timeoutMs?: number;
}

export interface FfmpegRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** 保留最近 maxLines 行的环形文本 */
function tailBuffer(maxLines: number): { push(line: string): void; join(): string } {
  const lines: string[] = [];
  return {
    push(line: string) {
      lines.push(line);
      if (lines.length > maxLines) lines.splice(0, lines.length - maxLines);
    },
    join() {
      return lines.join("");
    },
  };
}

/** 执行 ffmpeg（argv 首元素为可执行文件路径/名称），退出或中止后返回输出摘要 */
export async function runFfmpeg(argv: string[], opts: FfmpegRunOptions = {}): Promise<FfmpegRunResult> {
  if (argv.length === 0) {
    throw new BiliError("MERGE_FAILED", "ffmpeg 命令为空");
  }
  const fullArgs = [argv[0] as string, "-progress", "pipe:1", "-nostats", ...argv.slice(1)];
  const timeoutMs = opts.timeoutMs ?? 10 * 60_000;

  const child = spawn(fullArgs[0] as string, fullArgs.slice(1), {
    cwd: opts.cwd,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stdoutTail = tailBuffer(STDOUT_KEEP_LINES);
  const stderrTail = tailBuffer(STDERR_KEEP_LINES);
  let duration = 0;
  let lastOutTimeUs = 0;

  const parseDuration = (line: string): void => {
    for (const m of line.matchAll(DURATION_PATTERN)) {
      const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 100;
      if (sec > duration) duration = sec;
    }
  };

  const parseProgress = (line: string): void => {
    if (!line.startsWith(PROGRESS_TIME_KEY)) return;
    const value = Number(line.slice(PROGRESS_TIME_KEY.length).trim());
    if (Number.isFinite(value)) lastOutTimeUs = value;
    if (opts.onProgress && duration > 0) {
      const percent = Math.min(100, Math.max(0, (lastOutTimeUs / 1_000_000 / duration) * 100));
      opts.onProgress(percent);
    }
  };

  const readStream = async (
    stream: NodeJS.ReadableStream | null,
    onLine: (line: string) => void,
    tail: { push(line: string): void },
  ): Promise<void> => {
    if (!stream) return;
    let buffer = "";
    for await (const chunk of stream as AsyncIterable<Buffer | string>) {
      buffer += chunk.toString("utf8");
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx + 1);
        buffer = buffer.slice(idx + 1);
        tail.push(line);
        onLine(line);
      }
    }
    if (buffer.length > 0) {
      tail.push(buffer);
      onLine(buffer);
    }
  };

  const stdoutPromise = readStream(child.stdout, parseProgress, stdoutTail);
  const stderrPromise = readStream(child.stderr, parseDuration, stderrTail);

  const exitCode: number = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new BiliError("MERGE_FAILED", `ffmpeg 执行超时（${timeoutMs}ms）`));
    }, timeoutMs);

    const onAbort = (): void => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2000).unref();
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    child.once("error", (err) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      reject(
        new BiliError("MERGE_FAILED", `无法启动 ffmpeg：${String(err)}`, { cause: err }),
      );
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      resolve(code ?? -1);
    });
  });

  await Promise.all([stdoutPromise, stderrPromise]);

  if (opts.signal?.aborted) {
    throw new BiliError("MERGE_FAILED", "ffmpeg 处理被中止");
  }
  return { code: exitCode, stdout: stdoutTail.join(), stderr: stderrTail.join() };
}


