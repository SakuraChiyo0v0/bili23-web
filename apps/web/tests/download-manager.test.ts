import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { stat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
    streamOpts: Array<Record<string, unknown>>;
    pageCalls: number[];
    dashMode: boolean;
    pagination_totalPages: number | undefined;
  } = { parseItems: [], failFetch: false, downloads: [], streamOpts: [], pageCalls: [], dashMode: false, pagination_totalPages: undefined };
  return { state };
});

vi.mock("@bili23-web/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@bili23-web/engine")>();
  return {
    ...actual,
    ensureAnonymousSession: () => Promise.resolve(),
    parseUrl: vi.fn(async (_ctx: unknown, _url: string, options?: { pn?: number }) => {
      const pn = options?.pn ?? 1;
      h.state.pageCalls.push(pn);
      const items = h.state.parseItems;
      const totalPages = h.state.pagination_totalPages;
      if (totalPages !== undefined && pn > totalPages) {
        return { type: "video", title: "测试合集", items: [] };
      }
      return {
        type: "video",
        title: "测试合集",
        items,
        ...(totalPages !== undefined && pn <= totalPages ? { pagination: { total: totalPages * 10, page: pn, pageSize: 10, totalPages } } : {}),
      };
    }),
    fetchPlayMediaInfo: async () => {
      if (h.state.failFetch) {
        throw new actual.BiliError("DOWNLOAD_FAILED", "模拟解析/取流失败");
      }
      return { mediaType: "mp4", singleFileExt: "mp4" } as never;
    },
    resolveStreams: (info: Record<string, unknown>, streamOpts: Record<string, unknown>) => {
      h.state.streamOpts.push(streamOpts);
      if (h.state.dashMode) {
        return {
          mediaType: "dash",
          videoQualityId: 80,
          audioQualityId: 30280,
          videoCodecId: 7,
          videoRef: { baseUrl: "http://127.0.0.1/video.m4s", backupUrl: [] },
          audioRef: { baseUrl: "http://127.0.0.1/audio.m4s", backupUrl: [] },
          videoExt: "m4s",
        } as never;
      }
      return {
        mediaType: "mp4",
        videoQualityId: 80,
        audioQualityId: 0,
        videoCodecId: 7,
        durl: [{ order: 0, url: "http://127.0.0.1/fake.mp4", backupUrl: [] }],
      } as never;
    },
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
    remuxMedia: async (_i: string, out: string) => { await writeFile(out, Buffer.alloc(64, 1)); return { outputPath: out, code: 0, stderr: "" }; },
    mergeAudioVideo: async (_v: string, _a: string, out: string) => { await writeFile(out, Buffer.alloc(64, 1)); return { outputPath: out, code: 0, stderr: "" }; },
    concatMediaParts: async (_l: string, out: string) => { await writeFile(out, Buffer.alloc(64, 1)); return { outputPath: out, code: 0, stderr: "" }; },
  };
});

import { TaskStore, parseUrl, BiliError, HttpClient } from "@bili23-web/engine";
import { DownloadManager, normalizeExtrasStyles } from "../src/server/download-manager.js";
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

describe("DownloadManager 扫码登录", () => {
  it("qrLoginStart 返回二维码与 key；poll 成功时把 SESSDATA 落库并持久化", async () => {
    const dataDir = await mkdtemp(join(tmpRoot, "qrauth-"));
    // 模拟 B 站 passport：generate 返回二维码，poll 成功时 Set-Cookie SESSDATA
    const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      if (url.includes("qrcode/generate")) {
        return new Response(JSON.stringify({ code: 0, data: { url: "https://www.bilibili.com/??qr_login=qrcode", qrcode_key: "key123" } }), { status: 200 });
      }
      if (url.includes("qrcode/poll")) {
        return new Response(JSON.stringify({ code: 0, data: { code: 0, message: "ok" } }), {
          status: 200,
          headers: { "Set-Cookie": "SESSDATA=qr_sess_1; Path=/; Domain=.bilibili.com" },
        });
      }
      if (url.includes("/x/web-interface/nav")) {
        return new Response(JSON.stringify({ code: 0, data: { mid: 2, uname: "测试用户", face: "https://i0.hdslb.com/bfs/face/example.jpg" } }), { status: 200 });
      }
      return new Response("{}", { status: 500 });
    };
    const http = new HttpClient({ fetchImpl: fetchImpl as typeof fetch });
    let mgr: DownloadManagerType | undefined;
    try {
      mgr = new DownloadManager({ dataDir, httpClient: http });
      await mgr.init();
      const start = await mgr.qrLoginStart();
      expect(start.qrUrl).toContain("qr_login");
      expect(start.qrcodeKey).toBe("key123");

      const poll = await mgr.qrLoginPoll("key123");
      expect(poll.loggedIn).toBe(true);
      const st = await mgr.authStatus();
      expect(st.loggedIn).toBe(true);
      expect(st.uname).toBe("测试用户");
      expect(st.face).toBe("https://i0.hdslb.com/bfs/face/example.jpg");
      expect(st.mid).toBe(2);

      // 重启后持久化生效（含用户信息）
      mgr.close();
      mgr = undefined as unknown as DownloadManagerType;
      const mgr2 = new DownloadManager({ dataDir });
      await mgr2.init();
      const st2 = await mgr2.authStatus();
      expect(st2.loggedIn).toBe(true);
      expect(st2.preview).toBe("qr_sess_1");
      expect(st2.uname).toBe("测试用户");
      expect(st2.face).toBe("https://i0.hdslb.com/bfs/face/example.jpg");
      expect(st2.mid).toBe(2);
      mgr2.close();
    } finally {
      mgr?.close();
    }
  });

  it("poll 未扫码/过期时不登录", async () => {
    const dataDir = await mkdtemp(join(tmpRoot, "qrauth2-"));
    const fetchImpl = async (): Promise<Response> => {
      return new Response(JSON.stringify({ code: 0, data: { code: 86101, message: "waiting" } }), { status: 200 });
    };
    const http = new HttpClient({ fetchImpl: fetchImpl as typeof fetch });
    const mgr = new DownloadManager({ dataDir, httpClient: http });
    try {
      await mgr.init();
      const poll = await mgr.qrLoginPoll("key");
      expect(poll.loggedIn).toBe(false);
      expect((await mgr.authStatus()).loggedIn).toBe(false);
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

  it("分页类型：pages=9999 时按 pagination.totalPages 提前停止（搜索全部）", async () => {
    const mgr = await makeManager();
    try {
      h.state.parseItems = [makeItem(ID1, 280001) as unknown as Record<string, unknown>];
      h.state.pagination_totalPages = 3;
      h.state.pageCalls = [];
      const res = await mgr.parseRequest({ type: "space", query: "2", pn: 1, pages: 9999 });
      // 应只请求第 1..3 页，不请求超过 totalPages 的页
      expect(h.state.pageCalls).toEqual([1, 2, 3]);
      expect((res[0]?.pagination?.totalPages ?? 0)).toBe(3);
    } finally {
      mgr.close();
      h.state.pagination_totalPages = undefined;
      h.state.pageCalls = [];
    }
  });

  it("分页类型：pages=1 仅当前页，只请求起始页一次", async () => {
    const mgr = await makeManager();
    try {
      h.state.parseItems = [makeItem(ID1, 280001) as unknown as Record<string, unknown>];
      h.state.pagination_totalPages = 5;
      h.state.pageCalls = [];
      const res = await mgr.parseRequest({ type: "space", query: "2", pn: 2, pages: 1 });
      expect(h.state.pageCalls).toEqual([2]);
      expect(res.length).toBe(1);
      // 仅当前页：page 返回的是请求的页码 2
      expect(res[0]?.pagination?.page).toBe(2);
    } finally {
      mgr.close();
      h.state.pagination_totalPages = undefined;
      h.state.pageCalls = [];
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

describe("DownloadManager 设置语义（目录/命名/重名/重复）", () => {
  it("自定义下载目录会成为新任务的落盘根目录", async () => {
    const mgr = await makeManager();
    const customRoot = join(tmpRoot, "custom-root-" + Date.now());
    try {
      const items = await seedThree(mgr);
      await mgr.updateConfig({ download: { dir: customRoot } });
      expect(mgr.downloadRootDir()).toBe(customRoot);

      await mgr.createTasks([items[0]!.id], {});
      const taskId = taskIds(mgr)[0]!;
      await waitFor(() => statusOf(mgr, taskId)?.status === "downloading");
      await waitDownloads(1);
      releaseDownloads(1);
      await waitFor(() => statusOf(mgr, taskId)?.status === "completed", 10000);

      const output = statusOf(mgr, taskId)?.outputPath;
      expect(output).toBeDefined();
      expect(output!.startsWith(customRoot)).toBe(true);
      expect(await stat(output!)).toBeTruthy();
    } finally {
      mgr.close();
      h.state.downloads.length = 0;
    }
  });

  it("任务创建固化本次命名规则，并遵守覆盖与强制重复策略", async () => {
    const mgr = await makeManager();
    try {
      const items = await seedThree(mgr);
      const config = await mgr.getConfig();
      await mgr.updateConfig({
        download: { duplicatePolicy: "force", renamePolicy: "overwrite" },
        fileNaming: {
          ...config.fileNaming,
          rules: [
            ...config.fileNaming.rules,
            { id: "custom-normal", name: "自定义", type: 11, rule: "custom/{leaf_title}", default: false },
          ],
        },
      });

      const naming = { conventionType: 11, rule: "custom/{leaf_title}", number: 9 };
      const first = await mgr.createTasks([items[0]!.id], { naming });
      const firstId = first.tasks[0]!.id;
      await waitFor(() => statusOf(mgr, firstId)?.status === "downloading");
      await waitDownloads(1);
      releaseDownloads(1);
      await waitFor(() => statusOf(mgr, firstId)?.status === "completed", 10000);
      const firstPath = statusOf(mgr, firstId)?.outputPath;
      expect(firstPath).toContain("custom");

      const second = await mgr.createTasks([items[0]!.id], { naming });
      expect(second.duplicates).toEqual([]);
      const secondId = second.tasks[0]!.id;
      await waitFor(() => statusOf(mgr, secondId)?.status === "downloading");
      await waitDownloads(1);
      releaseDownloads(1);
      await waitFor(() => statusOf(mgr, secondId)?.status === "completed", 10000);
      expect(statusOf(mgr, secondId)?.outputPath).toBe(firstPath);
    } finally {
      mgr.close();
      h.state.downloads.length = 0;
    }
  });
});

describe("DownloadManager 保存解析历史开关（behavior.saveParseHistory）", () => {
  it("默认开启时 parseUrls 写入解析历史", async () => {
    const mgr = await makeManager();
    try {
      const items = await seedThree(mgr);
      expect(mgr.listParseHistory().length).toBeGreaterThan(0);
      const last = mgr.listParseHistory()[0]!;
      expect(last.itemCount).toBe(3);
      expect(last.type).toBe("video");
    } finally {
      mgr.close();
    }
  });

  it("关闭后 parseUrls 不再写入解析历史，历史保留旧记录", async () => {
    const mgr = await makeManager();
    try {
      await seedThree(mgr);
      const before = mgr.listParseHistory().length;
      expect(before).toBeGreaterThan(0);
      await mgr.updateConfig({ behavior: { saveParseHistory: false } });
      // 再次解析应不新增
      h.state.parseItems = [makeItem(ID1, 280001)] as never;
      await mgr.parseUrls(["https://www.bilibili.com/video/BV1xx411c7mD"]);
      expect(mgr.listParseHistory().length).toBe(before);
    } finally {
      mgr.close();
    }
  });
});

describe("DownloadManager 高级默认档位兜底（advanced.default*）", () => {
  it("任务未显式指定画质/音质/编码时，用 advanced 默认档位传给取流", async () => {
    const mgr = await makeManager();
    try {
      const items = await seedThree(mgr);
      await mgr.updateConfig({
        advanced: { defaultVideoQualityId: 116, defaultAudioQualityId: 30280, defaultCodecId: 12 },
        download: { parallel: 4 },
      });
      h.state.streamOpts = [];
      await mgr.createTasks([items[0]!.id], {});
      const taskId = taskIds(mgr)[0]!;
      await waitFor(() => statusOf(mgr, taskId)?.status === "downloading");
      await waitDownloads(1);
      await waitFor(() => h.state.streamOpts.length >= 1, 3000);
      const opts = h.state.streamOpts[h.state.streamOpts.length - 1]!;
      expect(opts.videoQualityId).toBe(116);
      expect(opts.audioQualityId).toBe(30280);
      expect(opts.videoCodecId).toBe(12);
      // 清理：放行当前下载避免遗留
      releaseDownloads(1);
      await waitFor(() => statusOf(mgr, taskId)?.status === "completed", 10000);
    } finally {
      mgr.close();
      h.state.downloads.length = 0;
      h.state.streamOpts = [];
    }
  });

  it("任务显式指定画质时覆盖 advanced 默认（不回退）", async () => {
    const mgr = await makeManager();
    try {
      const items = await seedThree(mgr);
      await mgr.updateConfig({ advanced: { defaultVideoQualityId: 116 } });
      h.state.streamOpts = [];
      await mgr.createTasks([items[0]!.id], { videoQualityId: 16 });
      const taskId = taskIds(mgr)[0]!;
      await waitFor(() => statusOf(mgr, taskId)?.status === "downloading");
      await waitDownloads(1);
      const opts = h.state.streamOpts[h.state.streamOpts.length - 1]!;
      expect(opts.videoQualityId).toBe(16);
      releaseDownloads(1);
      await waitFor(() => statusOf(mgr, taskId)?.status === "completed", 10000);
    } finally {
      mgr.close();
      h.state.downloads.length = 0;
      h.state.streamOpts = [];
      h.state.dashMode = false;
    }
  });
});

describe("DownloadManager 媒体流/合并/保留原文件（原版核心）", () => {
  it("downloadAudio=false 时不下载音频文件（仅视频）", async () => {
    const mgr = await makeManager();
    try {
      const items = await seedThree(mgr);
      const created = await mgr.createTasks([items[0]!.id], { downloadVideo: true, downloadAudio: false, container: "mp4" });
      const tid = created.tasks[0]!.id;
      await waitFor(() => statusOf(mgr, tid)?.status === "downloading");
      await waitDownloads(1);
      releaseDownloads(1);
      await waitFor(() => statusOf(mgr, tid)?.status === "completed", 10000);
      expect(statusOf(mgr, tid)?.outputPath).toContain(".mp4");
    } finally {
      mgr.close();
      h.state.downloads.length = 0;
      h.state.streamOpts = [];
    }
  });

  it("mergeVideoAudio=false 且同时下载音频时，视频/音频分开落盘", async () => {
    const mgr = await makeManager();
    try {
      const items = await seedThree(mgr);
      // 让 mock resolveStreams 返回 DASH 风格（video+audio）
      h.state.dashMode = true;
      h.state.streamOpts = [];
      const created = await mgr.createTasks([items[0]!.id], { downloadVideo: true, downloadAudio: true, mergeVideoAudio: false, container: "mp4" });
      const tid = created.tasks[0]!.id;
      await waitDownloads(1);
      releaseDownloads(1);
      await waitDownloads(1);
      releaseDownloads(1);
      await waitFor(() => statusOf(mgr, tid)?.status === "completed", 10000);
      expect(statusOf(mgr, tid)?.outputPath).toBeTruthy();
    } finally {
      mgr.close();
      h.state.downloads.length = 0;
      h.state.streamOpts = [];
      h.state.dashMode = false;
    }
  });
});
describe("DownloadManager 优先级透传", () => {
  it("任务传 videoQualityPriority/audioQualityPriority/videoCodecPriority 会透传到 resolveStreams", async () => {
    const mgr = await makeManager();
    try {
      const items = await seedThree(mgr);
      h.state.dashMode = true;
      h.state.streamOpts = [];
      await mgr.createTasks([items[0]!.id], {
        downloadVideo: true,
        downloadAudio: true,
        videoQualityPriority: [116, 112], audioQualityPriority: [30280], videoCodecPriority: [7],
      });
      const tid = taskIds(mgr)[0]!;
      await waitFor(() => statusOf(mgr, tid)?.status === "downloading");
      await waitFor(() => h.state.streamOpts.length >= 1, 3000);
      const opts = h.state.streamOpts[h.state.streamOpts.length - 1]!;
      expect(opts.videoQualityPriority).toEqual([116, 112]);
      expect(opts.audioQualityPriority).toEqual([30280]);
      expect(opts.videoCodecPriority).toEqual([7]);
      // 持续放行直到任务完成（DASH 有 video+audio 两个分片，逐个注册）
      for (let guard = 0; guard < 40 && statusOf(mgr, tid)?.status !== "completed"; guard += 1) {
        if (h.state.downloads.length > 0) releaseDownloads(h.state.downloads.length);
        await sleep(15);
      }
    } finally {
      mgr.close();
      h.state.downloads.length = 0;
      h.state.streamOpts = [];
      h.state.dashMode = false;
    }
  });
});
describe("DownloadManager 目录浏览（listSubdirs）", () => {
  it("仅返回子目录并过滤隐藏/忽略目录，按名称排序", async () => {
    const mgr = await makeManager();
    try {
      const root = join(tmpRoot, "dirs-browse");
      await mkdir(root, { recursive: true });
      await mkdir(join(root, "videos"), { recursive: true });
      await mkdir(join(root, "music"), { recursive: true });
      await mkdir(join(root, ".hidden"), { recursive: true });
      await mkdir(join(root, "node_modules"), { recursive: true });
      await mkdir(join(root, ".tmp"), { recursive: true });
      await writeFile(join(root, "a.txt"), "x");

      const out = await mgr.listSubdirs(root);
      expect(out.map((d) => d.name)).toEqual(["music", "videos"]);
      expect(out[0]?.path).toBe(join(root, "music"));
      expect(out[1]?.path).toBe(join(root, "videos"));

      // 文件路径 → 空列表；不存在路径 → 空列表
      expect(await mgr.listSubdirs(join(root, "a.txt"))).toEqual([]);
      expect(await mgr.listSubdirs(join(root, "nope"))).toEqual([]);
    } finally {
      mgr.close();
    }
  });
});

describe("normalizeExtrasStyles 空 style 兜底", () => {
  it("弹幕/字幕启用但 style 传空对象时回填默认样式", () => {
    const out = normalizeExtrasStyles({
      danmaku: { enabled: true, format: "ass", style: {}, embed: false, deleteAfterEmbed: false },
      subtitle: { enabled: true, format: "ass", style: {}, language: { downloadSpecified: false, specifiedLanguages: [] }, embed: false, deleteAfterEmbed: false },
    } as never);
    expect(Object.keys((out.danmaku!.style ?? {}) as object).length).toBeGreaterThan(0);
    expect(Object.keys((out.subtitle!.style ?? {}) as object).length).toBeGreaterThan(0);
  });

  it("style 已配置或未启用时不覆盖", () => {
    const out = normalizeExtrasStyles({
      danmaku: { enabled: true, format: "xml", style: { font: { name: "自定义" } }, embed: false, deleteAfterEmbed: false },
      subtitle: { enabled: false, format: "ass", style: {}, language: { downloadSpecified: false, specifiedLanguages: [] }, embed: false, deleteAfterEmbed: false },
    } as never);
    expect((out.danmaku!.style as { font?: { name?: string } }).font?.name).toBe("自定义");
    expect((out.subtitle!.style as object)).toEqual({});
  });
});
