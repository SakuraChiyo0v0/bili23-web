import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { BiliError } from "@bili23-web/engine";
import type { MediaItem, ParseResult } from "@bili23-web/engine";
import { createApp } from "../src/server/index.js";
import type { ApiDeps } from "../src/server/routes.js";
import { defaultAppConfig } from "../src/server/config.js";
import { resolveDownloadPath } from "../src/server/download-manager.js";
import type {
  DownloadOptions,
  FileEntry,
  HistoryEntryDto,
  MediaOptionSummary,
  TaskSummary,
} from "../src/server/download-manager.js";

const ITEM: MediaItem = {
  id: "video:BV1xx411c7mD:p1",
  type: "video",
  aid: 170001,
  bvid: "BV1xx411c7mD",
  cid: 280001,
  page: 1,
  title: "P1 标题",
  groupTitle: "视频A",
  duration: 213,
  badge: "",
  cover: "",
  pubtime: 1700000000,
  owner: { mid: 1, name: "up主", face: "" },
  desc: "",
  url: "https://www.bilibili.com/video/BV1xx411c7mD?p=1",
};

function makeTask(id: string, patch: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id,
    status: "queued",
    title: "P1 标题",
    groupTitle: "视频A",
    progress: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    createdAt: 1,
    updatedAt: 1,
    qualityLabel: "1080P",
    ...patch,
  };
}

function makeDeps(): ApiDeps & {
  cancelled: string[];
  created: Array<{ ids: string[]; options: DownloadOptions; force: boolean }>;
  paused: string[];
  resumed: string[];
  retried: string[];
  deleted: string[];
  historyDeleted: string[];
} {
  const cancelled: string[] = [];
  const created: Array<{ ids: string[]; options: DownloadOptions; force: boolean }> = [];
  const paused: string[] = [];
  const resumed: string[] = [];
  const retried: string[] = [];
  const deleted: string[] = [];
  const historyDeleted: string[] = [];
  const deps: ApiDeps = {
    async parseUrls(urls) {
      const results: ParseResult[] = urls.map((url) => ({
        type: "video" as const,
        title: "视频A",
        items: [{ ...ITEM, url }],
      }));
      return results;
    },
    async mediaOptions(itemId): Promise<MediaOptionSummary> {
      if (itemId !== ITEM.id) throw new BiliError("INVALID_URL", "条目不存在");
      return {
        itemId,
        mediaType: "dash",
        timelength: 213000,
        qualities: [{ id: 80, label: "1080P", codecs: [{ id: 7, label: "AVC/H.264" }], videoBandwidth: 1000000 }],
        audioQualities: [{ id: 30280, label: "192K", audioBandwidth: 192000 }],
      };
    },
    async createTasks(itemIds, options, force = false) {
      created.push({ ids: itemIds, options, force });
      if (!force && itemIds.includes("dup-item")) {
        return { tasks: [], duplicates: [{ itemId: "dup-item", title: "已有视频" }] };
      }
      return { tasks: [makeTask("task-1")], duplicates: [] };
    },
    listTasks() {
      return [makeTask("task-1", { status: "downloading", progress: 50 })];
    },
    getTask(id) {
      return id === "task-1" ? makeTask("task-1") : undefined;
    },
    subscribeTask(id, listener) {
      if (id !== "task-1") return undefined;
      listener(makeTask("task-1", { status: "downloading", progress: 10 }));
      return () => undefined;
    },
    cancelTask(id) {
      cancelled.push(id);
    },
    pauseTask(id) {
      paused.push(id);
      return makeTask(id, { status: "paused" });
    },
    resumeTask(id) {
      resumed.push(id);
      return makeTask(id, { status: "parsing" });
    },
    retryTask(id) {
      retried.push(id);
      return makeTask(id, { status: "queued" });
    },
    async deleteTask(id) {
      if (id === "nope") return false;
      deleted.push(id);
      return true;
    },
    listHistory(): HistoryEntryDto[] {
      return [{ taskId: "h1", title: "老视频", completedAt: 100, outputPath: "/data/x/a.mp4" }];
    },
    deleteHistory(taskId) {
      if (taskId === "nope") return false;
      historyDeleted.push(taskId);
      return true;
    },
    taskLog(id) {
      if (id !== "task-1") return undefined;
      return ["[12:00:00] 开始解析视频信息", "[12:00:01] 已加入队列"];
    },
    resolveDownloadFile() {
      return undefined;
    },
    async listFiles(): Promise<FileEntry[]> {
      return [{ name: "a.mp4", path: "视频A/a.mp4", size: 100, mtime: 1 }];
    },
  };
  return { ...deps, cancelled, created, paused, resumed, retried, deleted, historyDeleted };
}

describe("Web API 路由", () => {
  it("POST /api/parse 返回解析条目", async () => {
    const deps = makeDeps();
    const app = createApp({ manager: deps as never });
    const res = await app.request("/api/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls: ["https://www.bilibili.com/video/BV1xx411c7mD"] }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { results: ParseResult[] };
    expect(json.results[0]?.items[0]?.bvid).toBe("BV1xx411c7mD");
  });

  it("POST /api/parse 无链接返回 400", async () => {
    const app = createApp({ manager: makeDeps() as never });
    const res = await app.request("/api/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls: [] }),
    });
    expect(res.status).toBe(400);
  });

  it("GET /api/media/:itemId 返回可选画质", async () => {
    const app = createApp({ manager: makeDeps() as never });
    const res = await app.request("/api/media/" + encodeURIComponent(ITEM.id));
    expect(res.status).toBe(200);
    const json = (await res.json()) as MediaOptionSummary;
    expect(json.qualities[0]?.id).toBe(80);
  });

  it("POST /api/download 创建任务", async () => {
    const deps = makeDeps();
    const app = createApp({ manager: deps as never });
    const res = await app.request("/api/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemIds: [ITEM.id], options: { videoQualityId: 80 } }),
    });
    expect(res.status).toBe(200);
    expect(deps.created.length).toBe(1);
    expect(deps.created[0]?.options.videoQualityId).toBe(80);
  });

  it("重复下载未确认时返回 409 DUPLICATE", async () => {
    const app = createApp({ manager: makeDeps() as never });
    const res = await app.request("/api/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemIds: ["dup-item"], options: {} }),
    });
    expect(res.status).toBe(409);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("DUPLICATE");
  });

  it("GET /api/tasks 与 GET /api/files", async () => {
    const app = createApp({ manager: makeDeps() as never });
    const tasksRes = await app.request("/api/tasks");
    expect(((await tasksRes.json()) as { tasks: TaskSummary[] }).tasks.length).toBe(1);
    const filesRes = await app.request("/api/files");
    expect(((await filesRes.json()) as { files: FileEntry[] }).files[0]?.path).toBe("视频A/a.mp4");
  });

  it("任务不存在返回 404；cancel 生效", async () => {
    const deps = makeDeps();
    const app = createApp({ manager: deps as never });
    const missing = await app.request("/api/tasks/nope");
    expect(missing.status).toBe(404);
    const cancel = await app.request("/api/tasks/task-1/cancel", { method: "POST" });
    expect(cancel.status).toBe(200);
    expect(deps.cancelled).toEqual(["task-1"]);
  });

  it("SSE /api/tasks/:id/events 推送任务快照", async () => {
    const app = createApp({ manager: makeDeps() as never });
    const res = await app.request("/api/tasks/task-1/events");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("text/event-stream");
    const reader = res.body?.getReader();
    expect(reader).toBeTruthy();
    const first = await reader!.read();
    const text = new TextDecoder().decode(first.value);
    expect(text).toContain("event: task");
    expect(text).toContain("task-1");
    await reader!.cancel();
  });

  it("POST /api/tasks/:id/pause：合法状态 200、不存在 404、非法状态 409", async () => {
    const deps = makeDeps();
    const app = createApp({ manager: deps as never });
    const ok = await app.request("/api/tasks/task-1/pause", { method: "POST" });
    expect(ok.status).toBe(200);
    expect(deps.paused).toEqual(["task-1"]);

    const missing = createApp({ manager: makeDeps() as never });
    expect((await missing.request("/api/tasks/nope/pause", { method: "POST" })).status).toBe(404);

    const bad = makeDeps();
    bad.getTask = (id) =>
      id === "task-1" ? makeTask("task-1", { status: "completed" }) : undefined;
    const appBad = createApp({ manager: bad as never });
    const conflict = await appBad.request("/api/tasks/task-1/pause", { method: "POST" });
    expect(conflict.status).toBe(409);
  });

  it("POST /api/tasks/:id/resume：paused 200、运行中 409、不存在 404", async () => {
    const deps = makeDeps();
    deps.getTask = (id) =>
      id === "task-1" ? makeTask("task-1", { status: "paused" }) : undefined;
    const app = createApp({ manager: deps as never });
    const ok = await app.request("/api/tasks/task-1/resume", { method: "POST" });
    expect(ok.status).toBe(200);
    expect(deps.resumed).toEqual(["task-1"]);

    const bad = makeDeps();
    bad.getTask = (id) =>
      id === "task-1" ? makeTask("task-1", { status: "downloading" }) : undefined;
    const conflict = await createApp({ manager: bad as never }).request(
      "/api/tasks/task-1/resume",
      { method: "POST" },
    );
    expect(conflict.status).toBe(409);

    const missing = createApp({ manager: makeDeps() as never });
    expect((await missing.request("/api/tasks/nope/resume", { method: "POST" })).status).toBe(404);
  });

  it("POST /api/tasks/:id/retry：failed 200、queued 409、不存在 404", async () => {
    const deps = makeDeps();
    deps.getTask = (id) =>
      id === "task-1" ? makeTask("task-1", { status: "failed", error: "x" }) : undefined;
    const app = createApp({ manager: deps as never });
    const ok = await app.request("/api/tasks/task-1/retry", { method: "POST" });
    expect(ok.status).toBe(200);
    expect(deps.retried).toEqual(["task-1"]);

    const bad = makeDeps();
    bad.getTask = (id) =>
      id === "task-1" ? makeTask("task-1", { status: "queued" }) : undefined;
    const conflict = await createApp({ manager: bad as never }).request(
      "/api/tasks/task-1/retry",
      { method: "POST" },
    );
    expect(conflict.status).toBe(409);

    const missing = createApp({ manager: makeDeps() as never });
    expect((await missing.request("/api/tasks/nope/retry", { method: "POST" })).status).toBe(404);
  });

  it("POST /api/tasks/:id/delete：存在 200、不存在 404", async () => {
    const deps = makeDeps();
    const app = createApp({ manager: deps as never });
    const ok = await app.request("/api/tasks/task-1/delete", { method: "POST" });
    expect(ok.status).toBe(200);
    expect(deps.deleted).toEqual(["task-1"]);
    const missing = await app.request("/api/tasks/nope/delete", { method: "POST" });
    expect(missing.status).toBe(404);
  });

  it("GET /api/history 与 DELETE /api/history/:taskId", async () => {
    const deps = makeDeps();
    const app = createApp({ manager: deps as never });
    const listRes = await app.request("/api/history");
    expect(listRes.status).toBe(200);
    const json = (await listRes.json()) as { history: HistoryEntryDto[] };
    expect(json.history[0]?.taskId).toBe("h1");

    const del = await app.request("/api/history/h1", { method: "DELETE" });
    expect(del.status).toBe(200);
    expect(deps.historyDeleted).toEqual(["h1"]);

    const missing = await app.request("/api/history/nope", { method: "DELETE" });
    expect(missing.status).toBe(404);
  });

  it("GET /api/tasks/:id/log 返回任务日志；不存在 404", async () => {
    const app = createApp({ manager: makeDeps() as never });
    const ok = await app.request("/api/tasks/task-1/log");
    expect(ok.status).toBe(200);
    const json = (await ok.json()) as { lines: string[] };
    expect(json.lines.length).toBe(2);
    const missing = await app.request("/api/tasks/nope/log");
    expect(missing.status).toBe(404);
  });

  it("GET /api/files/raw：防目录穿越、目录/缺失处理、流式返回文件", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bili23-raw-"));
    try {
      await writeFile(join(dir, "ok.mp4"), "hello-bytes");
      await mkdir(join(dir, "subdir"));
      const deps = makeDeps();
      deps.resolveDownloadFile = (rel) => {
        if (rel === "ok.mp4") return join(dir, "ok.mp4");
        if (rel === "missing.mp4") return join(dir, "missing.mp4");
        if (rel === "subdir") return join(dir, "subdir");
        return undefined; // 越界/绝对路径解析阶段即被拒
      };
      const app = createApp({ manager: deps as never });

      const ok = await app.request("/api/files/raw?path=ok.mp4");
      expect(ok.status).toBe(200);
      expect(await ok.text()).toBe("hello-bytes");

      const traversal = await app.request(
        "/api/files/raw?path=" + encodeURIComponent("../secret.txt"),
      );
      expect(traversal.status).toBe(400);

      const absolute = await app.request(
        "/api/files/raw?path=" + encodeURIComponent("C:\\Windows\\win.ini"),
      );
      expect(absolute.status).toBe(400);

      const missing = await app.request("/api/files/raw?path=missing.mp4");
      expect(missing.status).toBe(404);

      const dirRes = await app.request("/api/files/raw?path=subdir");
      expect(dirRes.status).toBe(400);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("PUT /api/config 非法值映射为 400 INVALID_CONFIG", async () => {
    const deps = makeDeps();
    deps.getConfig = async () => defaultAppConfig();
    deps.updateConfig = async () => {
      throw new Error("download.parallel 需为 1..16 的整数");
    };
    const app = createApp({ manager: deps as never });
    const res = await app.request("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: { download: { parallel: 0 } } }),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("INVALID_CONFIG");
  });
});

describe("resolveDownloadPath 防目录穿越", () => {
  it("根目录内相对路径正常解析", () => {
    const root = resolve(join(tmpdir(), "dl-root"));
    expect(resolveDownloadPath(root, "视频A/a.mp4")).toBe(join(root, "视频A", "a.mp4"));
    expect(resolveDownloadPath(root, "a/./b.mp4")).toBe(join(root, "a", "b.mp4"));
  });

  it("拒绝 ../ 与绝对路径（越界）", () => {
    const root = resolve(join(tmpdir(), "dl-root"));
    expect(resolveDownloadPath(root, "../secret.txt")).toBeUndefined();
    expect(resolveDownloadPath(root, "a/../../secret.txt")).toBeUndefined();
    expect(resolveDownloadPath(root, "C:\\Windows\\win.ini")).toBeUndefined();
    expect(resolveDownloadPath(root, "/etc/passwd")).toBeUndefined();
  });
});

describe("/api/dirs 目录选择接口", () => {
  it("manager.listSubdirs 缺省时返回空列表；存在时透传子目录", async () => {
    const root = await mkdtemp(join(tmpdir(), "bili23-dirs-api-"));
    try {
      const mk = (withImpl: boolean) => {
        const deps = makeDeps();
        if (withImpl) {
          (deps as unknown as { listSubdirs: unknown }).listSubdirs = async (dir: string) => {
            if (dir === root) return [{ name: "downloads", path: join(root, "downloads") }, { name: "videos", path: join(root, "videos") }];
            return [];
          };
        }
        return createApp({ manager: deps as never });
      };

      const enc = encodeURIComponent(root);
      const appNo = mk(false);
      let res = await appNo.request("/api/dirs?path=" + enc);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ dirs: [] });

      const app = mk(true);
      res = await app.request("/api/dirs?path=" + enc);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        dirs: [
          { name: "downloads", path: join(root, "downloads") },
          { name: "videos", path: join(root, "videos") },
        ],
      });

      res = await app.request("/api/dirs");
      expect(await res.json()).toEqual({ dirs: [] });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
