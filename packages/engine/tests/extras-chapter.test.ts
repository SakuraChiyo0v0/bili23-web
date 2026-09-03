import { describe, expect, it } from "vitest";
import { buildChapterFfmetadata, chapterFileName, escapeFfmetadataValue } from "../src/extras/chapter.js";
import type { ViewPoint } from "../src/extras/chapter.js";

describe("extras/chapter", () => {
  it("escapeFfmetadataValue 转义 = ; # \\ 与换行", () => {
    expect(escapeFfmetadataValue("a=b;c#d\\e")).toBe("a\\=b\\;c\\#d\\\\e");
    expect(escapeFfmetadataValue("line1\nline2")).toBe("line1\\\nline2");
  });

  it("chapterFileName 对齐上游 chapter_{task_id}.txt", () => {
    expect(chapterFileName("t1")).toBe("chapter_t1.txt");
  });

  it("buildChapterFfmetadata 生成 ffmetadata 章节块（毫秒、转义、末尾空行）", () => {
    const points: ViewPoint[] = [
      { from: 0, to: 120, content: "A = B" },
      { from: 120, to: 0, content: "B\\C" }, // to=0 → 回落到下一段 from
      { from: 240, to: 300, content: "Last #1" },
    ];
    const out = buildChapterFfmetadata(points, 360);
    const expected = [
      ";FFMETADATA1",
      "",
      "[CHAPTER]",
      "TIMEBASE=1/1000",
      "START=0",
      "END=120000",
      "title=A \\= B",
      "",
      "[CHAPTER]",
      "TIMEBASE=1/1000",
      "START=120000",
      "END=240000",
      "title=B\\\\C",
      "",
      "[CHAPTER]",
      "TIMEBASE=1/1000",
      "START=240000",
      "END=300000",
      "title=Last \\#1",
      "",
    ].join("\n");
    expect(out).toBe(expected);
  });

  it("末段 to 无效时用视频总时长兜底；仍无法确定则跳过该段", () => {
    // 末段 to=0 且无下一段 → 用总时长 360
    const out = buildChapterFfmetadata([{ from: 300, to: 0, content: "tail" }], 360);
    expect(out).toContain("END=360000");

    // 总时长兜底仍 <= start → 跳过
    const skipped = buildChapterFfmetadata([{ from: 500, to: 0, content: "bad" }], 360);
    expect(skipped).toBe(";FFMETADATA1\n");
  });

  it("无章节数据时只输出头", () => {
    expect(buildChapterFfmetadata([], 100)).toBe(";FFMETADATA1\n");
  });
});
