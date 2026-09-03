/**
 * 全局限速门（SpeedGate）。
 * 与 downloader.ts 内单次下载自建的 TokenBucket 不同，SpeedGate 可被多个下载/任务共享，
 * 且支持运行时即时调整速率（setBps，0=不限速）。
 * Node 单线程事件循环天然等价于桌面锁保护的关键区，因此无需额外锁。
 */
import { DownloadAbortedError } from "./downloader.js";

/** 等待指定毫秒，可被 signal 中断（对齐 downloader.sleepInterruptible 语义） */
function sleepInterruptible(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
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

/**
 * 共享令牌桶限速门：多个消费方可并发 take，总速率（跨调用累计）不超过设定。
 * 速率单位字节/秒；0 表示不限速。
 */
export class SpeedGate {
  /** 当前速率（字节/秒），0=不限速 */
  #rate: number;
  /** 当前可用令牌（≤ 一个速率窗口的额度） */
  #tokens = 0;
  /** 上次补充令牌的时间（毫秒） */
  #lastUpdate = 0;

  constructor(bps = 0) {
    this.#rate = 0;
    this.setBps(bps);
  }

  /** 调整速率：0=不限速；即时生效（新请求按新速率约束） */
  setBps(bps: number): void {
    const rate = Number.isFinite(bps) && bps > 0 ? bps : 0;
    this.#rate = rate;
    this.#tokens = rate;
    this.#lastUpdate = Date.now();
  }

  /** 消耗 bytes 字节；令牌不足按速率休眠补齐，可被 signal 中断 */
  async take(bytes: number, signal?: AbortSignal): Promise<void> {
    if (this.#rate <= 0 || bytes <= 0) return;
    const now = Date.now();
    const elapsed = (now - this.#lastUpdate) / 1000;
    this.#lastUpdate = now;
    this.#tokens = Math.min(this.#rate, this.#tokens + elapsed * this.#rate);
    this.#tokens -= bytes;
    if (this.#tokens < 0) {
      const waitMs = (-this.#tokens / this.#rate) * 1000;
      await sleepInterruptible(waitMs, signal);
    }
  }
}
