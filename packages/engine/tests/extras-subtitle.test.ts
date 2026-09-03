import { describe, expect, it } from "vitest";
import { toSubtitleSrt } from "../src/extras/subtitle-srt.js";
import { toSubtitleLrc } from "../src/extras/subtitle-lrc.js";
import { toSubtitleTxt } from "../src/extras/subtitle-txt.js";
import { toSubtitleAss, buildSubtitleStyleLine, toIso639_2, subtitleTrackTitle } from "../src/extras/subtitle-ass.js";
import { toSubtitleJson } from "../src/extras/subtitle-json.js";
import { DEFAULT_SUBTITLE_STYLE } from "../src/extras/types.js";
import type { SubtitleJson } from "../src/extras/types.js";

/** B 站字幕 JSON fixture（含 body 之外的元信息，保留原样输出） */
const SUBTITLE: SubtitleJson = {
  font_size: 0.4,
  font_color: "#FFFFFF",
  body: [
    { from: 1.0, to: 3.0, location: 2, content: "hello" },
    { from: 5.5, to: 8.25, location: 2, content: "second line" },
    { from: 65.5, to: 70.2, content: "minute mark" },
  ],
};

describe("subtitle converters", () => {
  it("json → srt：编号 + HH:MM:SS,mmm 时间轴 + 空行分段", () => {
    expect(toSubtitleSrt(SUBTITLE)).toBe(
      [
        "1",
        "00:00:01,000 --> 00:00:03,000",
        "hello",
        "",
        "2",
        "00:00:05,500 --> 00:00:08,250",
        "second line",
        "",
        "3",
        "00:01:05,500 --> 00:01:10,200",
        "minute mark",
      ].join("\n"),
    );
  });

  it("json → lrc：[MM:SS.xx] 时间标签", () => {
    expect(toSubtitleLrc(SUBTITLE)).toBe("[00:01.00]hello\n[00:05.50]second line\n[01:05.50]minute mark");
  });

  it("json → txt：逐条文本", () => {
    expect(toSubtitleTxt(SUBTITLE)).toBe("hello\nsecond line\nminute mark");
  });

  it("json → json：indent=2 原样保留", () => {
    const out = toSubtitleJson(SUBTITLE);
    expect(JSON.parse(out)).toEqual(SUBTITLE);
    expect(out.startsWith("{\n  ")).toBe(true);
  });

  it("json → ass：默认样式行 + Dialogue 秒级时间轴", () => {
    const out = toSubtitleAss(SUBTITLE, "Sample Video");
    expect(out).toContain("Style: Default,黑体,36,&H00FFFFFF,&H000000FF,H00000000,H00000000,0,0,0,0,100,100,0,0,1,1.0,0.0,2,10,10,20,1");
    expect(out).toContain("Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,hello");
    expect(out).toContain("Dialogue: 0,0:00:05.50,0:00:08.25,Default,,0,0,0,,second line");
    expect(out).toContain("Dialogue: 0,0:01:05.50,0:01:10.20,Default,,0,0,0,,minute mark");
    expect(out).toContain("Title: Sample Video");
  });

  it("buildSubtitleStyleLine 输出上游默认样式行", () => {
    expect(buildSubtitleStyleLine(DEFAULT_SUBTITLE_STYLE)).toBe(
      "Style: Default,黑体,36,&H00FFFFFF,&H000000FF,H00000000,H00000000,0,0,0,0,100,100,0,0,1,1.0,0.0,2,10,10,20,1",
    );
  });

  it("空 body 各格式输出空串", () => {
    expect(toSubtitleSrt({ body: [] })).toBe("");
    expect(toSubtitleLrc({ body: [] })).toBe("");
    expect(toSubtitleTxt({ body: [] })).toBe("");
    expect(toSubtitleAss({ body: [] }, "t")).toContain("[Events]");
  });
});

describe("subtitle language helpers", () => {
  it("toIso639_2 归一化（含 AI 前缀与 BCP-47 大小写）", () => {
    expect(toIso639_2("zh")).toBe("chi");
    expect(toIso639_2("zh-Hant")).toBe("chi");
    expect(toIso639_2("en-US")).toBe("eng");
    expect(toIso639_2("ja")).toBe("jpn");
    expect(toIso639_2("ai-zh")).toBe("chi");
    expect(toIso639_2("AI-EN")).toBe("eng");
    expect(toIso639_2("yue")).toBe("yue"); // 表外原样返回
  });

  it("subtitleTrackTitle：AI 字幕标注来源", () => {
    expect(subtitleTrackTitle("zh", "中文")).toBe("中文");
    expect(subtitleTrackTitle("ai-zh", "中文")).toBe("中文 (AI Generated)");
    expect(subtitleTrackTitle("ai-zh")).toBe("ai-zh (AI Generated)");
    expect(subtitleTrackTitle("en", "")).toBe("en");
  });
});
