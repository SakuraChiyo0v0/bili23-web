import { describe, expect, it } from "vitest";
import { calcHashId, stableJson } from "../src/store/hash.js";
import { HistoryService } from "../src/store/history.js";
import { TaskStore } from "../src/store/task-store.js";

function makeStore(): TaskStore {
  return new TaskStore(":memory:");
}

describe("calcHashId（对齐桌面 hash_id.py）", () => {
  it("投稿视频使用 {bvid,cid,aid} 的稳定 JSON 计算 md5", () => {
    const hash = calcHashId({ type: "video", aid: 170001, bvid: "BV1xx411c7mD", cid: 280001 });
    expect(hash).toBe("9071bf2d5edf5bb71625aa637860b678");
  });

  it("稳定 JSON 按键排序、无空白", () => {
    expect(stableJson({ cid: 1, bvid: "BV", aid: 2 })).toBe('{"aid":2,"bvid":"BV","cid":1}');
  });

  it("空值归一化后结果一致（aid/cid 缺失视为 0）", () => {
    const a = calcHashId({ type: "video", aid: null, bvid: "BV1xx411c7mD", cid: 280001 });
    const b = calcHashId({ type: "video", bvid: "BV1xx411c7mD", cid: 280001 });
    expect(a).toBe(b);
  });

  it("不同类型使用不同元数据字段，互不冲突", () => {
    const video = calcHashId({ type: "video", aid: 1, bvid: "BVx", cid: 2 });
    const audio = calcHashId({ type: "audio", sid: 3 });
    const unknown = calcHashId({ type: "weird", taskId: "t1" });
    expect(video).not.toBe(audio);
    expect(unknown).not.toBe(audio);
  });
});

describe("TaskStore 任务持久化", () => {
  it("进行中任务：插入/查询/更新/删除", () => {
    const store = makeStore();
    const snap = { status: "downloading", progress: 0.5, chunk: { totalChunks: 2, offsets: { 0: 100 } } };
    store.upsertActive({ taskId: "t1", hashId: "h1", title: "视频A", data: snap });
    const got = store.getActive("t1");
    expect(got?.title).toBe("视频A");
    expect(got?.data).toEqual(snap);

    store.updateActiveData("t1", { status: "downloading", progress: 0.9 });
    expect((store.getActive("t1")?.data as { progress: number }).progress).toBe(0.9);

    store.removeActive("t1");
    expect(store.getActive("t1")).toBeNull();
    store.close();
  });

  it("历史任务：写入并按时间倒序、limit 生效", () => {
    const store = makeStore();
    store.addCompleted({ taskId: "c1", hashId: "h1", title: "老视频", time: 100, data: {} });
    store.addCompleted({ taskId: "c2", hashId: "h2", title: "新视频", time: 200, data: {} });
    const all = store.listCompleted();
    expect(all.map((r) => r.taskId)).toEqual(["c2", "c1"]);
    const one = store.listCompleted(1);
    expect(one.map((r) => r.taskId)).toEqual(["c2"]);
    expect(store.getCompleted("c1")?.title).toBe("老视频");
    store.close();
  });

  it("重复判定覆盖进行中与已完成", () => {
    const store = makeStore();
    expect(store.checkDuplicate("h-video")).toBe(false);
    store.upsertActive({ taskId: "t1", hashId: "h-video", title: "A", data: {} });
    expect(store.checkDuplicate("h-video")).toBe(true);
    store.removeActive("t1");
    store.addCompleted({ taskId: "c1", hashId: "h-video", title: "A", data: {} });
    expect(store.checkDuplicate("h-video")).toBe(true);
    store.close();
  });

  it("同一 task_id 重复写入按 upsert 更新", () => {
    const store = makeStore();
    store.upsertActive({ taskId: "t1", hashId: "h1", title: "标题1", data: { n: 1 } });
    store.upsertActive({ taskId: "t1", hashId: "h1", title: "标题2", data: { n: 2 } });
    const list = store.listActive();
    expect(list.length).toBe(1);
    expect(list[0]?.title).toBe("标题2");
    store.close();
  });
});

describe("HistoryService 去重查询", () => {
  it("isDuplicate 命中已完成历史；hashOf 与直接计算一致", () => {
    const store = makeStore();
    const svc = new HistoryService(store);
    const hash = svc.hashOf({ type: "video", aid: 170001, bvid: "BV1xx411c7mD", cid: 280001 });
    expect(hash).toBe("9071bf2d5edf5bb71625aa637860b678");
    expect(svc.isDuplicate(hash)).toBe(false);
    store.addCompleted({ taskId: "c1", hashId: hash, title: "A", data: {} });
    expect(svc.isDuplicate(hash)).toBe(true);
    const recent = svc.listRecent(10);
    expect(recent.length).toBe(1);
    expect(recent[0]?.title).toBe("A");
    store.close();
  });
});
