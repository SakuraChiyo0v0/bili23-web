import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MediaItem } from "@bili23-web/engine";

// 离线测试：mock @bili23-web/engine 的网络/ffmpeg 入口，
// TaskStore/HistoryService/命名/附加内容等纯逻辑仍走真实实现。
const h = vi.hoisted(() => {
  const state: {
    parseItems: Array<Record<string, unknown>>;
    failFetch: boolean;
    downloads: Array<{ resolve: () => void; reject: (e: unknown) => void }>;
  } = { parseItems: [], failFetch: false, downloads: [] };
  return { state };
});

vi.mock("@bili23-web/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@bili23-web/engine")>();
  return {
    ...actual,
    ensureAnonymousSession: () => Promise.resolve(),
    parseUrl: vi.fn(async () => ({
      type: "video",
      title: "测试合集",
      items: h.state.parseItems,
    })),
    fetchPlayMediaInfo: async () => {
      if (h.state.failFetch) {
        throw new actual.BiliError("DOWNLOAD_FAILED", "模拟解析/取流失败");
      }
      return { mediaType: "mp4", singleFileExt: "mp4" } as never;
    },
    resolveStreams: () =>
      ({
        mediaType: "mp4",
        videoQualityId: 80,
        audioQualityId: 0,
        videoCodecId: 7,
        durl: [{ order: 0, url: "http://127.0.0.1/fake.mp4", backupUrl: [] }],
      }) as never,
    probeStreamUrl: async () => ({ url: "http://127.0.0.1/fake.mp4", fileSize: 100 }),
    downloadFile: async (opts: Record<string, unknown>) => {
      await new Promise<void>((resolve, reject) => {
        const signal = opts.signal as AbortSignal | undefined;
        const entry = { resolve, reject };
        if (signal?.aborted) {
          reject(new actual.DownloadAbortedError());
          return;
        }
        const onAbort = (): void => {
          const i = h.state.downloads.indexOf(entry);
          if (i >= 0) h.state.downloads.splice(i, 1);
          reject(new actual.DownloadAbortedError());
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        h.state.downloads.push(entry);
      });
      // 模拟落盘：写入文件供后续改名/落盘
      const destPath = opts.destPath as string;
      const fileSize = opts.fileSize as number;
      await writeFile(destPath, Buffer.alloc(fileSize, 1));
      const state = { totalChunks: 1, offsets: { 0: fileSize } };
      (opts.onProgress as ((p: unknown) => void) | undefined)?.({
        downloadedBytes: fileSize,
        totalBytes: fileSize,
      });
      (opts.onSnapshot as ((s: unknown) => void) | undefined)?.(state);
      return { url: "http://127.0.0.1/fake.mp4", fileSize, downloadedBytes: fileSize, state };
    },
    probeMedia: async () => ({ ok: true, format: { duration: 1 } }) as never,
  };
});

import { TaskStore, parseUrl, BiliError } from "@bili23-web/engine";
import { DownloadManager } from "../src/server/download-manager.js";
import type { DownloadManager as DownloadManagerType } from "../src/server/download-manager.js";
import type { TaskSummary } from "../src/server/download-manager.js";

const BVID = "BV1xx411c7mD";
const ID1 = `video:${BVID}:p1`;
const ID2 = `video:${BVID}:p2`;
const ID3 = `video:${BVID}:p3`;

function makeItem(id: string, cid: number): MediaItem {
  return {
    id,
    type: "video",
    aid: 170001,
    bvid: BVID,
    cid,
    page: cid - 280000,
    title: id + " 标题",
    groupTitle: "视频A",
    duration: 213,
    badge: "",
    cover: "",
    pubtime: 1700000000,
    owner: { mid: 1, name: "up主", face: "" },
    desc: "",
    url: `https://www.bilibili.com/video/${BVID}?p=${cid - 280000}`,
  };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn: () => boolean, timeoutMs = 8000): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    if (fn()) return;
    if (Date.now() - t0 > timeoutMs) throw new Error("waitFor 超时");
    await sleep(15);
  }
}

let tmpRoot = "";

async function makeManager(dataDir?: string): Promise<DownloadManagerType> {
  const dir = dataDir ?? (await mkdtemp(join(tmpRoot, "mgr-")));
  const mgr = new DownloadManager({ dataDir: dir });
  await mgr.init();
  return mgr;
}

/** 预置 3 个互不冲突（cid 不同 → hash 不同）的解析条目并解析进会话 */
async function seedThree(mgr: DownloadManagerType): Promise<MediaItem[]> {
  const items = [makeItem(ID1, 280001), makeItem(ID2, 280002), makeItem(ID3, 280003)];
  h.state.parseItems = items as unknown as Array<Record<string, unknown>>;
  await mgr.parseUrls(items.map((i) => i.url));
  return items;
}

function taskIds(mgr: DownloadManagerType): string[] {
  return mgr.listTasks().map((t) => t.id);
}

function statusOf(mgr: DownloadManagerType, taskId: string): TaskSummary | undefined {
  return mgr.getTask(taskId);
}

function releaseDownloads(count: number): void {
  for (let i = 0; i < count; i += 1) {
    const d = h.state.downloads.shift();
    d?.resolve();
  }
}

/** 等待 mock 下载注册达到指定数量（status=downloading 先于注册发生，需等待避免空放行） */
async function waitDownloads(count: number): Promise<void> {
  await waitFor(() => h.state.downloads.length >= count, 5000);
}

beforeAll(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "bili23-mgr-"));
});

afterAll(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

describe("DownloadManager 登录 Cookie（auth）", () => {
  it("登录后 authStatus 为已登录并持久化；退出后恢复未登录", async () => {
    const dataDir = await mkdtemp(join(tmpRoot, "auth-"));
    let mgr = await makeManager(dataDir);
    let mgr2: DownloadManagerType | undefined;
    try {
      expect(await mgr.authStatus()).toEqual({ loggedIn: false, preview: "" });

      const logged = await mgr.loginAuth("  abc12345xyz  ");
      expect(logged.loggedIn).toBe(true);
      expect(logged.preview).toBe("abc1…5xyz");
      expect((await mgr.authStatus()).loggedIn).toBe(true);

      // 重启后仍能还原
      mgr.close();
      mgr = undefined as unknown as DownloadManagerType;
      mgr2 = new DownloadManager({ dataDir });
      await mgr2.init();
      expect(await mgr2.authStatus()).toEqual({ loggedIn: true, preview: "abc1…5xyz" });

      expect(await mgr2.logoutAuth()).toEqual({ loggedIn: false, preview: "" });
      expect(await mgr2.authStatus()).toEqual({ loggedIn: false, preview: "" });
    } finally {
      mgr?.close();
      mgr2?.close();
    }
  });

  it("空 SESSDATA 抛错", async () => {
    const mgr = await makeManager();
    try {
      await expect(mgr.loginAuth("   ")).rejects.toBeInstanceOf(BiliError);
    } finally {
      mgr.close();
    }
  });
});

describe("DownloadManager parseRequest（类型入口）", () => {
  it("未知类型抛 UNSUPPORTED_TYPE", async () => {
    const mgr = await makeManager();
    try {
      await expect(mgr.parseRequest({ type: "bogus", query: "x" })).rejects.toMatchObject({
        code: "UNSUPPORTED_TYPE",
      });
    } finally {
      mgr.close();
    }
  });

  it("space 空输入抛 INVALID_URL", async () => {
    const mgr = await makeManager();
    try {
      await expect(mgr.parseRequest({ type: "space", query: "" })).rejects.toMatchObject({
        code: "INVALID_URL",
      });
    } finally {
      mgr.close();
    }
  });

  it("space 数字 UID 构造 space 链接并走 parseUrl", async () => {
    const mgr = await makeManager();
    try {
      h.state.parseItems = [makeItem(ID1, 280001) as unknown as Record<string, unknown>];
      const calls = (parseUrl as unknown as { mock: { calls: Array<[unknown, string]> } }).mock.calls;
      calls.length = 0;
      const res = await mgr.parseRequest({ type: "space", query: "2", keyword: "abc" });
      expect(res.length).toBe(1);
      expect(calls[calls.length - 1]?.[1]).toBe("https://space.bilibili.com/2?keyword=abc");
    } finally {
      mgr.close();
    }
  });

  it("watch_later 构造伪协议链接并走 parseUrl", async () => {
    const mgr = await makeManager();
    try {
      h.state.parseItems = [makeItem(ID1, 280001) as unknown as Record<string, unknown>];
      const calls = (parseUrl as unknown as { mock: { calls: Array<[unknown, string]> } }).mock.calls;
      calls.length = 0;
      const res = await mgr.parseRequest({ type: "watch_later", keyword: "test" });
      expect(res.length).toBe(1);
      expect(calls[calls.length - 1]?.[1]).toBe("bili23://watch_later?key=test");
    } finally {
      mgr.close();
    }
  });
});

describe("DownloadManager 队列/暂停/恢复/重启恢复", () => {
  it("并行上限=2：第 3 个任务 queued，直到有槽位释放才启动；完成后进入历史", async () => {
    const mgr = await makeManager();
    try {
      const items = await seedThree(mgr);
      const created = await mgr.createTasks(items.map((i) => i.id), {});
      expect(created.tasks.length).toBe(3);
      expect(created.duplicates.length).toBe(0);
      const createdIds = taskIds(mgr);
      const t1 = createdIds[0]!;
      const t2 = createdIds[1]!;
      const t3 = createdIds[2]!;

      // 前两个进入 downloading，第 3 个排队
      await waitFor(
        () =>
          statusOf(mgr, t1)?.status === "downloading" && statusOf(mgr, t2)?.status === "downloading",
      );
      expect(statusOf(mgr, t3)?.status).toBe("queued");

      // 释放一个槽位 → 第 3 个开始下载（任一前两个仍在运行即满足并发上限；不依赖释放顺序）
      await waitDownloads(2);
      releaseDownloads(1);
      await waitFor(() => statusOf(mgr, t3)?.status === "downloading");
      const stillRunning = [t1, t2].filter((id) => statusOf(mgr, id)?.status === "downloading").length;
      expect(stillRunning).toBeGreaterThan(0);

      // 释放剩余两个下载 → 全部完成进入历史
      await waitDownloads(2);
      releaseDownloads(2);
      await waitFor(
        () => [t1, t2, t3].every((id) => statusOf(mgr, id)?.status === "completed"),
        10000,
      );
      await waitFor(() => mgr.listHistory().length === 3, 10000);
    } finally {
      mgr.close();
      h.state.downloads.length = 0;
    }
  });

  it("暂停保留 download_task 行；重启 init 后=interrupted；resume 续传完成进历史", async () => {
    const dir = join(tmpRoot, "pause-resume-" + Date.now());
    const mgr1 = await makeManager(dir);
    try {
      const items = await seedThree(mgr1);
      await mgr1.createTasks([items[0]!.id], {});
      const taskId = taskIds(mgr1)[0]!;
      await waitFor(() => statusOf(mgr1, taskId)?.status === "downloading");

      mgr1.pauseTask(taskId);
      await waitFor(() => statusOf(mgr1, taskId)?.status === "paused");
      h.state.downloads.length = 0; // 被 abort 拒绝的 mock 下载已自行移除，这里兜底
      mgr1.close();

      // 重启：同一数据目录新 manager，init 后任务=interrupted（断点行仍在）
      const mgr2 = await makeManager(dir);
      try {
        expect(statusOf(mgr2, taskId)?.status).toBe("interrupted");
        expect(statusOf(mgr2, taskId)?.error).toContain("服务重启");

        mgr2.resumeTask(taskId);
        await waitFor(() => statusOf(mgr2, taskId)?.status === "downloading");
        await waitDownloads(1);
        releaseDownloads(1);
        await waitFor(() => statusOf(mgr2, taskId)?.status === "completed", 10000);
        await waitFor(() => mgr2.listHistory().length === 1, 10000);
      } finally {
        mgr2.close();
      }
    } finally {
      h.state.downloads.length = 0;
    }
  });

  it("失败任务 retry 重建并重新下载（clear 断点）", async () => {
    const mgr = await makeManager();
    try {
      const items = await seedThree(mgr);
      h.state.failFetch = true;
      await mgr.createTasks([items[0]!.id], {});
      const taskId = taskIds(mgr)[0]!;
      await waitFor(() => statusOf(mgr, taskId)?.status === "failed");
      expect(statusOf(mgr, taskId)?.error).toContain("模拟解析/取流失败");
      expect(mgr.listHistory().length).toBe(0);

      h.state.failFetch = false;
      mgr.retryTask(taskId);
      await waitFor(() => statusOf(mgr, taskId)?.status === "downloading");
      await waitDownloads(1);
      releaseDownloads(1);
      await waitFor(() => statusOf(mgr, taskId)?.status === "completed", 10000);
      await waitFor(() => mgr.listHistory().length === 1, 10000);
    } finally {
      mgr.close();
      h.state.downloads.length = 0;
      h.state.failFetch = false;
    }
  });

  it("deleteTask 删除内存任务与 download_task 行", async () => {
    const dir = join(tmpRoot, "delete-" + Date.now());
    const mgr = await makeManager(dir);
    try {
      const items = await seedThree(mgr);
      await mgr.createTasks([items[0]!.id], {});
      const taskId = taskIds(mgr)[0]!;
      await waitFor(() => statusOf(mgr, taskId)?.status === "downloading");
      const ok = await mgr.deleteTask(taskId);
      expect(ok).toBe(true);
      expect(statusOf(mgr, taskId)).toBeUndefined();
      mgr.close();

      // 同一数据目录重启 init：download_task 行已删除，不应再出现
      const mgr2 = await makeManager(dir);
      try {
        expect(statusOf(mgr2, taskId)).toBeUndefined();
        expect(mgr2.listHistory().length).toBe(0);
      } finally {
        mgr2.close();
      }
    } finally {
      h.state.downloads.length = 0;
    }
  });
});

describe("DownloadManager 重启恢复（预置 download_task 行）", () => {
  it("init 把遗留任务标为 interrupted，不自动 run", async () => {
    const dir = join(tmpRoot, "rehydrate-" + Date.now());
    await mkdir(dir, { recursive: true });
    const store = new TaskStore(join(dir, "task.db"));
    const legacy = makeItem(`video:${BVID}:p9`, 280009);
    store.upsertActive({
      taskId: "legacy-1",
      hashId: "h-legacy-1",
      title: legacy.title,
      data: {
        item: legacy,
        options: {},
        status: "downloading",
        files: { video_part_0: { totalChunks: 1, offsets: { 0: 40 } } },
      },
    });
    store.close();

    const mgr = await makeManager(dir);
    try {
      const task = mgr.getTask("legacy-1");
      expect(task?.status).toBe("interrupted");
      expect(task?.error).toContain("服务重启");
      expect(mgr.listTasks().every((t) => t.status !== "downloading")).toBe(true);
      expect(mgr.listHistory().length).toBe(0);
    } finally {
      mgr.close();
    }
  });
});
