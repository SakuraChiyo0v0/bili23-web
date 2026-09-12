import { describe, expect, it } from "vitest";
import { stepDuplicates, type DuplicateItem } from "../src/client/lib/duplicateQueue.js";

const Q: DuplicateItem[] = [
  { itemId: "a", title: "第一条" },
  { itemId: "b", title: "第二条" },
  { itemId: "c", title: "第三条" },
];

describe("重复项逐条询问的推进（原版 DuplicateDownloadDialog）", () => {
  it("不勾不再询问：只处理当前这条，其余留在队列里继续问", () => {
    expect(stepDuplicates(Q, true, false)).toEqual({
      force: ["a"], skip: [], rest: Q.slice(1), done: false,
    });
    expect(stepDuplicates(Q, false, false)).toEqual({
      force: [], skip: ["a"], rest: Q.slice(1), done: false,
    });
  });

  it("最后一条处理完 → done（调用方据此关掉两个弹窗）", () => {
    expect(stepDuplicates([Q[2]!], true, false)).toEqual({
      force: ["c"], skip: [], rest: [], done: true,
    });
  });

  it("勾了不再询问 + 继续下载：本条与剩下全部强制下载，并写回 force", () => {
    expect(stepDuplicates(Q, true, true)).toEqual({
      force: ["a", "b", "c"], skip: [], policy: "force", rest: [], done: true,
    });
  });

  it("勾了不再询问 + 跳过下载：本条与剩下全部跳过，并写回 skip", () => {
    expect(stepDuplicates(Q, false, true)).toEqual({
      force: [], skip: ["a", "b", "c"], policy: "skip", rest: [], done: true,
    });
  });

  it("空队列是安全的（返回 done，不产生任何动作）", () => {
    expect(stepDuplicates([], true, false)).toEqual({ force: [], skip: [], rest: [], done: true });
    expect(stepDuplicates([], false, true)).toEqual({ force: [], skip: [], rest: [], done: true });
  });
});
