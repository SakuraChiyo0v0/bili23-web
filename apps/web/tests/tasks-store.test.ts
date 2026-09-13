import { describe, expect, it } from "vitest";
import { mergeTasks, upsertTask } from "../src/client/lib/taskOrder.js";

/**
 * 任务列表顺序稳定性 —— 回归测试。
 *
 * 背景（用户实测）：同时下 20 多话时列表"1 到 20 一直在轮流转，一直在闪"。
 * 根因是更新任务时把该项"删掉再追加到末尾"：每秒多次的进度推送会让正在下载的任务
 * 不断跳到列表末尾；而同一秒创建的任务 `createdAt` 相同、按创建时间排序**等于没排**，
 * 顺序完全由数组决定 → 疯狂跳动。
 *
 * 这里直接测纯函数（store 用的就是它们），不依赖浏览器环境。
 */
const t = (id: string, extra: Record<string, unknown> = {}) => ({ id, ...extra });

describe("taskOrder：任务列表顺序", () => {
  it("upsert 已存在的项 → 原地替换，位置不变", () => {
    const list = ["a", "b", "c", "d"].map((id) => t(id));
    let out = list;
    for (let i = 1; i <= 5; i++) {
      out = upsertTask(out, t("b", { progress: i * 10 }));
      expect(out.map((x) => x.id)).toEqual(["a", "b", "c", "d"]);
    }
    expect(out[1]).toMatchObject({ id: "b", progress: 50 });   // 内容确实更新
    expect(list[1]).toEqual({ id: "b" });                      // 不改原数组
  });

  it("upsert 不存在的项 → 追加到末尾", () => {
    expect(upsertTask([t("a"), t("b")], t("c")).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("mergeTasks：已有的不动位置、只补新任务", () => {
    const out = mergeTasks([t("a"), t("b")], [t("b"), t("c"), t("d")]);
    expect(out.map((x) => x.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("mergeTasks 全是已知项时不改变顺序", () => {
    const list = [t("a"), t("b")];
    expect(mergeTasks(list, [t("b"), t("a")]).map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("20 个同秒创建的任务：连续进度更新后顺序不变（用户那个场景）", () => {
    const ids = Array.from({ length: 20 }, (_, i) => `ep${String(i + 1).padStart(2, "0")}`);
    let out = ids.map((id) => t(id, { createdAt: 1789296490 }));
    const before = out.map((x) => x.id);

    // 模拟调度器在两个任务之间来回推进度（每秒多次），持续若干轮
    for (let round = 0; round < 10; round++) {
      for (const id of ["ep02", "ep03"]) {
        out = upsertTask(out, t(id, { createdAt: 1789296490, status: "downloading", progress: round * 7 }));
      }
    }
    expect(out.map((x) => x.id)).toEqual(before);
  });
});
