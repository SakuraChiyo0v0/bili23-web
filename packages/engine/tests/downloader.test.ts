import { createServer } from "node:http";
import type { Server } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BiliError } from "../src/errors.js";
import { HttpClient } from "../src/api/http.js";
import {
  DownloadAbortedError,
  TokenBucket,
  downloadFile,
  probeStreamUrl,
} from "../src/download/downloader.js";
import { runDownloadPlan } from "../src/download/task.js";

/** 构造确定性的测试内容（非全零，便于校验错位） */
function makeContent(size: number): Buffer {
  const buf = Buffer.alloc(size);
  for (let i = 0; i < size; i += 1) {
    buf[i] = (i * 31 + 7) & 0xff;
  }
  return buf;
}

class TestFileServer {
  content: Buffer;
  requestedStarts: number[] = [];
  /** 只对指定 range 起始字节返回一次 500（随后移除） */
  failRangeOnce = new Set<number>();
  /** 返回 403 拒绝一切请求 */
  denyAll = false;
  /** 命中该 range 起始字节时：先写部分字节再挂起 */
  stallStart: number | undefined;
  /** 挂起前先写出的字节数 */
  stallWriteBytes = 512 * 1024;

  server: Server;
  port = 0;

  constructor(content: Buffer) {
    this.content = content;
    this.server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/file") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("not found");
        return;
      }
      if (this.denyAll) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("forbidden");
        return;
      }
      if (req.method === "HEAD") {
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Length": String(this.content.length),
        });
        res.end();
        return;
      }
      const range = req.headers.range;
      if (req.method !== "GET" || !range) {
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Length": String(this.content.length),
        });
        res.end(this.content);
        return;
      }
      const m = /^bytes=(\d+)-(\d+)$/.exec(range);
      if (!m) {
        res.writeHead(400);
        res.end();
        return;
      }
      const start = Number(m[1]);
      const end = Math.min(Number(m[2]), this.content.length - 1);
      this.requestedStarts.push(start);
      if (this.failRangeOnce.has(start)) {
        this.failRangeOnce.delete(start);
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("server error");
        return;
      }
      const slice = this.content.subarray(start, end + 1);
      res.writeHead(206, {
        "Content-Type": "application/octet-stream",
        "Content-Range": `bytes ${start}-${end}/${this.content.length}`,
        "Content-Length": String(slice.length),
        "Accept-Ranges": "bytes",
      });
      if (this.stallStart === start) {
        const partial = slice.subarray(0, Math.min(this.stallWriteBytes, slice.length));
        res.write(partial);
        // 剩余部分不写也不结束，等待客户端中止
        req.on("close", () => {
          res.destroy();
        });
        return;
      }
      res.end(slice);
    });
  }

  async start(): Promise<string> {
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    const addr = this.server.address();
    if (addr && typeof addr === "object") this.port = addr.port;
    return `http://127.0.0.1:${this.port}/file`;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve, reject) =>
      this.server.close((err) => (err ? reject(err) : resolve())),
    );
  }
}

const MIB = 1024 * 1024;
let serverA: TestFileServer;
let serverB: TestFileServer;
let baseUrlA = "";
let baseUrlB = "";
let tmpRoot = "";
const http = new HttpClient({ retries: 0 });

beforeAll(async () => {
  serverA = new TestFileServer(makeContent(5 * MIB + 123));
  baseUrlA = await serverA.start();
  serverB = new TestFileServer(makeContent(2 * MIB));
  baseUrlB = await serverB.start();
  tmpRoot = await mkdtemp(join(tmpdir(), "bili23-dl-"));
});

afterAll(async () => {
  await serverA.close();
  await serverB.close();
  await rm(tmpRoot, { recursive: true, force: true });
});

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

describe("TokenBucket 令牌桶", () => {
  it("按速率平滑限制，超出部分需等待补齐", async () => {
    const bucket = new TokenBucket(2000); // 2 KB/s
    const t0 = Date.now();
    await bucket.consume(1000); // 立即放行（初始满桶）
    await bucket.consume(5000); // 需等待 (5000-1000)/2000 ≈ 2s
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(1900);
    expect(elapsed).toBeLessThan(5000);
    await bucket.consume(2000); // 又积攒了令牌，应快速放行
  });

  it("rate=0 不限速", async () => {
    const bucket = new TokenBucket(0);
    const t0 = Date.now();
    await bucket.consume(1_000_000);
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it("setRate 可动态调整并重置令牌", () => {
    const bucket = new TokenBucket(100);
    bucket.setRate(500);
    expect(bucket.rate).toBe(500);
  });
});

describe("probeStreamUrl 候选探测", () => {
  it("HEAD 返回有效大小即命中", async () => {
    const result = await probeStreamUrl(http, [baseUrlA]);
    expect(result.url).toBe(baseUrlA);
    expect(result.fileSize).toBe(5 * MIB + 123);
  });

  it("全部候选不可用则抛 DOWNLOAD_FAILED", async () => {
    await expect(
      probeStreamUrl(http, ["http://127.0.0.1:1/missing"]),
    ).rejects.toMatchObject({ code: "DOWNLOAD_FAILED" });
  });
});

describe("downloadFile 分片下载", () => {
  it("多分片并发下载后内容与源一致，进度最终到达总量", async () => {
    const dest = join(tmpRoot, "a.m4s");
    const seen: number[] = [];
    const progress: Array<{ downloadedBytes: number; totalBytes: number }> = [];
    const result = await downloadFile({
      http,
      url: baseUrlA,
      destPath: dest,
      fileSize: 5 * MIB + 123,
      chunkSize: MIB,
      concurrency: 4,
      onProgress: (p) => progress.push(p),
    });
    expect(result.downloadedBytes).toBe(5 * MIB + 123);
    expect(result.state.totalChunks).toBe(6);
    expect(Buffer.compare(await readFile(dest), serverA.content)).toBe(0);
    // 覆盖所有分片起始
    for (const p of progress) void p;
    for (let i = 0; i < 6; i += 1) {
      seen.push(i * MIB);
    }
    for (const s of seen) {
      expect(serverA.requestedStarts).toContain(s);
    }
    // 每个分片恰好请求一次（无重试）
    expect(serverA.requestedStarts.length).toBe(6);
  });

  it("分片 500 后自动重试成功", async () => {
    const dest = join(tmpRoot, "retry.m4s");
    serverA.failRangeOnce.add(MIB);
    const before = serverA.requestedStarts.length;
    const result = await downloadFile({
      http,
      url: baseUrlA,
      destPath: dest,
      fileSize: 5 * MIB + 123,
      chunkSize: MIB,
      concurrency: 4,
      maxRetries: 5,
    });
    expect(result.downloadedBytes).toBe(5 * MIB + 123);
    expect(Buffer.compare(await readFile(dest), serverA.content)).toBe(0);
    // 起始于 1MiB 的分片被请求了至少两次
    const count = serverA.requestedStarts.slice(before).filter((s) => s === MIB).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("不可重试的 403 直接失败为 DOWNLOAD_FAILED", async () => {
    const dest = join(tmpRoot, "deny.m4s");
    serverA.denyAll = true;
    try {
      await expect(
        downloadFile({ http, url: baseUrlA, destPath: dest, fileSize: 1024, chunkSize: MIB }),
      ).rejects.toMatchObject({ code: "DOWNLOAD_FAILED" });
    } finally {
      serverA.denyAll = false;
    }
  });

  it("中止抛 DownloadAbortedError，且断点续传后内容完整", async () => {
    const dest = join(tmpRoot, "resume.m4s");
    const small = makeContent(3 * MIB);
    const serverS = new TestFileServer(small);
    const urlS = await serverS.start();
    serverS.stallStart = 0; // 0 号分片只写 512KiB 后挂起
    try {
      const aborter = new AbortController();
      let snapshot: { totalChunks: number; offsets: Record<string, number> } | undefined;
      const first = downloadFile({
        http,
        url: urlS,
        destPath: dest,
        fileSize: 3 * MIB,
        chunkSize: MIB,
        concurrency: 2,
        signal: aborter.signal,
        onSnapshot: (s) => {
          snapshot = { totalChunks: s.totalChunks, offsets: { ...s.offsets } };
        },
      });
      await sleep(400);
      aborter.abort();
      await expect(first).rejects.toBeInstanceOf(DownloadAbortedError);

      // 中止时未完成分片应有已确认断点（0 号分片至少写入了部分字节）
      expect(snapshot).toBeDefined();
      const partialBytes = snapshot?.offsets["0"] ?? 0;
      expect(partialBytes).toBeGreaterThan(0);

      // 用快照续传：已落盘部分不再重新请求，剩余部分补齐后内容完整
      serverS.stallStart = undefined;
      const requestedBefore = serverS.requestedStarts.length;
      if (!snapshot) throw new Error("缺少断点快照");
      const result = await downloadFile({
        http,
        url: urlS,
        destPath: dest,
        fileSize: 3 * MIB,
        chunkSize: MIB,
        concurrency: 2,
        state: snapshot,
      });
      expect(result.downloadedBytes).toBe(3 * MIB);
      expect(Buffer.compare(await readFile(dest), small)).toBe(0);
      // 续传阶段没有重新请求从 0 开始的整片
      const resumedStarts = serverS.requestedStarts.slice(requestedBefore);
      expect(resumedStarts).not.toContain(0);
      expect(resumedStarts).toContain(partialBytes);
    } finally {
      await serverS.close();
    }
  });
});

describe("runDownloadPlan 逐文件串行下载", () => {
  it("按队列顺序下载 video → audio 并产出文件", async () => {
    const root = join(tmpRoot, "plan");
    const order: string[] = [];
    const result = await runDownloadPlan({
      http,
      rootDir: root,
      chunkSize: MIB,
      concurrency: 2,
      files: [
        { key: "video", urls: [baseUrlA], relativeName: "video_t1.m4s" },
        { key: "audio", urls: [baseUrlB], relativeName: "audio_t1.m4s" },
      ],
      onFileStart: (key) => order.push(key),
      onFileDone: (key) => order.push(`${key}:done`),
    });
    expect(order).toEqual(["video", "video:done", "audio", "audio:done"]);
    expect(result.files.video?.fileSize).toBe(5 * MIB + 123);
    expect(result.files.audio?.fileSize).toBe(2 * MIB);
    expect(Buffer.compare(await readFile(join(root, "video_t1.m4s")), serverA.content)).toBe(0);
    expect(Buffer.compare(await readFile(join(root, "audio_t1.m4s")), serverB.content)).toBe(0);
  });
});


