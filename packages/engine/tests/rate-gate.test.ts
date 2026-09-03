import { describe, expect, it } from "vitest";
import { SpeedGate } from "../src/download/rate.js";
import { DownloadAbortedError } from "../src/download/downloader.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 多路消费者并发 take，持续 durationMs，返回总消费字节数 */
async function consumeFor(
  gate: SpeedGate,
  chunk: number,
  workers: number,
  durationMs: number,
): Promise<{ consumed: number; elapsedSec: number }> {
  let consumed = 0;
  const t0 = Date.now();
  const deadline = t0 + durationMs;
  const tasks = Array.from({ length: workers }, async () => {
    while (Date.now() < deadline) {
      await gate.take(chunk);
      consumed += chunk;
    }
  });
  await Promise.all(tasks);
  return { consumed, elapsedSec: (Date.now() - t0) / 1000 };
}

describe("SpeedGate 共享限速门", () => {
  it("多路并发 take 总速率不超过设定（±10% 容差）", async () => {
    const rate = 100_000; // 100 KB/s
    const gate = new SpeedGate(rate);
    await gate.take(rate); // 清空初始令牌（一次性突发额度），之后按速率匀速放行
    const { consumed, elapsedSec } = await consumeFor(gate, 8 * 1024, 4, 1600);
    const expected = rate * elapsedSec;
    expect(consumed).toBeGreaterThan(0);
    // 总速率不应超过设定（允许 ±10% 计时误差 + 单个分片余量）
    expect(consumed).toBeLessThanOrEqual(expected * 1.1 + 8 * 1024);
    // 也不应完全不放行（过低说明门卡死）
    expect(consumed).toBeGreaterThan(expected * 0.5);
  });

  it("setBps 调低后新请求立即受新速率约束", async () => {
    const gate = new SpeedGate(1_000_000); // 初始高速
    await gate.take(1_000_000); // 清空初始令牌
    gate.setBps(20_000); // 调低到 20 KB/s
    await gate.take(20_000); // 清空 setBps 重新授予的令牌
    const t0 = Date.now();
    let consumed = 0;
    const chunk = 4096;
    while (Date.now() - t0 < 1100) {
      await gate.take(chunk);
      consumed += chunk;
    }
    const elapsed = (Date.now() - t0) / 1000;
    expect(consumed).toBeGreaterThan(0);
    expect(consumed).toBeLessThanOrEqual(20_000 * elapsed * 1.1 + chunk);
  });

  it("bps=0 不限速", async () => {
    const gate = new SpeedGate(0);
    const t0 = Date.now();
    for (let i = 0; i < 20; i += 1) {
      await gate.take(1_000_000);
    }
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it("负值/非法速率按 0（不限速）处理", async () => {
    const gate = new SpeedGate(-5);
    const t0 = Date.now();
    await gate.take(50_000);
    expect(Date.now() - t0).toBeLessThan(300);
    gate.setBps(Number.NaN);
    await gate.take(50_000);
    expect(Date.now() - t0).toBeLessThan(300);
  });

  it("等待令牌期间可被 signal 中断（DownloadAbortedError）", async () => {
    const gate = new SpeedGate(1000);
    await gate.take(1000); // 清空初始令牌
    const ctrl = new AbortController();
    const pending = gate.take(100_000, ctrl.signal); // 需等待 ~100s
    await sleep(30);
    ctrl.abort();
    await expect(pending).rejects.toBeInstanceOf(DownloadAbortedError);
  });
});
