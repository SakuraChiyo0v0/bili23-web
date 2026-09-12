import { describe, expect, it } from "vitest";
import { fmtBytes, fmtSpeed, taskInfoText, taskSizeText, taskStatusText } from "../src/client/lib/taskText.js";
import type { TaskSummary } from "../src/client/services/types.js";

function mkTask(extra: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id: "t1", status: "downloading", title: "标题", groupTitle: "分组",
    progress: 0, downloadedBytes: 0, totalBytes: 0,
    createdAt: 1_600_000_000, updatedAt: 1_600_000_100, qualityLabel: "",
    ...extra,
  };
}

/** 判据逐条来自原版 download_list/item_delegate.py 的 UIData */
describe("taskSizeText（原版 getSizeText）", () => {
  it("总量为 0 → 空串（不显示占位）", () => {
    expect(taskSizeText(mkTask({ totalBytes: 0 }))).toBe("");
  });

  it("下载中 → 「已下 / 总量」", () => {
    expect(taskSizeText(mkTask({ downloadedBytes: 1024 * 1024, totalBytes: 4 * 1024 * 1024 }))).toBe("1.0 MB / 4.0 MB");
  });

  it("完成/合并中/取消 → **只显示总量**", () => {
    for (const status of ["completed", "merging", "cancelled"] as const) {
      expect(taskSizeText(mkTask({ status, downloadedBytes: 1024, totalBytes: 4 * 1024 * 1024 }))).toBe("4.0 MB");
    }
  });

  it("失败仍然显示「已下 / 总量」（原版只有 FFmpeg 失败才只给总量，下载失败不给）", () => {
    // 注意 fmtBytes 的精度：KB 档不带小数（"1 KB"），MB 及以上带一位（"4.0 MB"）
    expect(taskSizeText(mkTask({ status: "failed", downloadedBytes: 1024, totalBytes: 4 * 1024 * 1024 }))).toBe("1 KB / 4.0 MB");
  });
});

describe("taskStatusText（原版 getStatusText）", () => {
  it("下载中显示的是**速度**，不是「下载中」三个字", () => {
    expect(taskStatusText(mkTask({ status: "downloading", speedBps: 2 * 1024 * 1024 }))).toBe("2.0 MB/s");
  });

  it("下载中但还没有速度样本 → 空串", () => {
    expect(taskStatusText(mkTask({ status: "downloading", speedBps: 0 }))).toBe("");
  });

  it("合并中带百分比；进度为 0 时不带（原版：免得挂着一个始终停在 0% 的数字）", () => {
    expect(taskStatusText(mkTask({ status: "merging", progress: 42 }))).toBe("合并中 42%");
    expect(taskStatusText(mkTask({ status: "merging", progress: 0 }))).toBe("合并中");
  });

  it("其余状态就是状态文案", () => {
    expect(taskStatusText(mkTask({ status: "queued" }))).toBe("排队中");
    expect(taskStatusText(mkTask({ status: "paused" }))).toBe("已暂停");
    expect(taskStatusText(mkTask({ status: "completed" }))).toBe("已完成");
    expect(taskStatusText(mkTask({ status: "failed" }))).toBe("失败");
  });
});

describe("taskInfoText（原版 getInfoText）", () => {
  it("完成时显示完成时间", () => {
    const s = taskInfoText(mkTask({ status: "completed", updatedAt: 1_600_000_100 }));
    expect(s).not.toBe("分组");
    expect(s.length).toBeGreaterThan(0);
  });

  it("其余状态显示信息标签（我们用 groupTitle 兜底）", () => {
    expect(taskInfoText(mkTask({ status: "downloading", groupTitle: "分组" }))).toBe("分组");
  });
});

describe("fmtBytes / fmtSpeed", () => {
  it("字节格式化", () => {
    expect(fmtBytes(0)).toBe("0 B");
    expect(fmtBytes(512)).toBe("512 B");
    expect(fmtBytes(1024 * 1024 * 1024)).toBe("1.0 GB");
  });
  it("速度：≥1MB 用 MB/s，否则 KB/s；无样本空串", () => {
    expect(fmtSpeed(undefined)).toBe("");
    expect(fmtSpeed(0)).toBe("");
    expect(fmtSpeed(1024 * 1024)).toBe("1.0 MB/s");
    expect(fmtSpeed(512 * 1024)).toBe("512 KB/s");
  });
});
