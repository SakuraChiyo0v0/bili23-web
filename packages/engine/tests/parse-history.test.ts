import { describe, expect, it } from "vitest";
import { TaskStore } from "../src/store/task-store.js";

function makeStore(): TaskStore {
  return new TaskStore(":memory:");
}

describe("TaskStore 解析历史", () => {
  it("addParseHistory/listParseHistory/removeParseHistory", () => {
    const store = makeStore();
    const id1 = store.addParseHistory({ url: "https://www.bilibili.com/video/BV1xx411c7mD", title: "视频A", type: "video", itemCount: 2 });
    const id2 = store.addParseHistory({ url: "https://space.bilibili.com/123/lists/456?type=season", title: "合集", type: "list", itemCount: 5 });
    expect(id1).toBeGreaterThan(0);
    expect(id2).toBeGreaterThan(id1);

    const list = store.listParseHistory();
    expect(list).toHaveLength(2);
    // 倒序：后插入的在前
    expect(list[0]?.url).toContain("lists/456");
    expect(list[0]?.type).toBe("list");
    expect(list[0]?.itemCount).toBe(5);
    expect(list[1]?.url).toContain("/video/BV1xx411c7mD");
    expect(list[1]?.itemCount).toBe(2);

    expect(store.removeParseHistory(id1)).toBe(true);
    expect(store.listParseHistory()).toHaveLength(1);
    expect(store.removeParseHistory(id1)).toBe(false);
  });

  it("listParseHistory 支持 limit", () => {
    const store = makeStore();
    store.addParseHistory({ url: "u1", title: "A", type: "video", itemCount: 1 });
    store.addParseHistory({ url: "u2", title: "B", type: "video", itemCount: 1 });
    expect(store.listParseHistory(1)).toHaveLength(1);
  });
});
