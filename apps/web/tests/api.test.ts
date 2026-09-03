import { describe, expect, it } from "vitest";
import { BiliError } from "@bili23-web/engine";
import type { MediaItem, ParseResult } from "@bili23-web/engine";
import { createApp } from "../src/server/index.js";
import type { ApiDeps } from "../src/server/routes.js";
import type {
  DownloadOptions,
  FileEntry,
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

function makeDeps(): ApiDeps & { cancelled: string[]; created: Array<{ ids: string[]; options: DownloadOptions; force: boolean }> } {
  const cancelled: string[] = [];
  const created: Array<{ ids: string[]; options: DownloadOptions; force: boolean }> = [];
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
        qualities: [{ id: 80, label: "1080P", codecs: [{ id: 7, label: "AVC/H.264" }] }],
        audioQualities: [{ id: 30280, label: "192K" }],
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
    async listFiles(): Promise<FileEntry[]> {
      return [{ name: "a.mp4", path: "视频A/a.mp4", size: 100, mtime: 1 }];
    },
  };
  return { ...deps, cancelled, created };
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
});
