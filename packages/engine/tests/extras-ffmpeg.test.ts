import { describe, expect, it } from "vitest";
import {
  buildConcatPartsEx,
  buildMergeAudioVideoEx,
  buildMergeAudioVideo,
} from "../src/ffmpeg/command.js";
import type { MergeExtras, SubtitleTrackSpec } from "../src/ffmpeg/command.js";
import { buildAttachCoverToMedia, buildCoverConvertArgs, coverFileName } from "../src/extras/cover.js";

describe("ffmpeg extras 命令构造", () => {
  it("buildMergeAudioVideoEx 无附加内容时与基础命令一致", () => {
    expect(buildMergeAudioVideoEx("v.mp4", "a.m4a", "o.mkv", {})).toEqual(
      buildMergeAudioVideo("v.mp4", "a.m4a", "o.mkv"),
    );
  });

  it("封面 attach：输入顺序 video/audio/cover，映射与 disposition 对齐桌面", () => {
    const argv = buildMergeAudioVideoEx("v.mp4", "a.m4a", "o.mp4", { coverPath: "c.jpg" });
    expect(argv).toEqual([
      "ffmpeg", "-y",
      "-i", "v.mp4",
      "-i", "a.m4a",
      "-i", "c.jpg",
      "-c:v", "copy",
      "-c:a", "copy",
      "-strict", "unofficial",
      "-map", "0:v:0",
      "-map", "1:a:0",
      "-map", "2:v:0",
      "-c:v:1", "png",
      "-disposition:v:1", "attached_pic",
      "-pix_fmt:v:1", "rgba",
      "o.mp4",
    ]);
  });

  it("无封面时字幕轨触发显式主映射（防默认流选择失效）", () => {
    const tracks: SubtitleTrackSpec[] = [
      { file: "sub.ass", title: "字幕", language: "chi", kind: "subtitle", default: true },
    ];
    const argv = buildMergeAudioVideoEx("v.mp4", "a.m4a", "o.mkv", { subtitleTracks: tracks });
    const flat = argv.join(" ");
    expect(flat).toContain("-map 0:v:0 -map 1:a:0");
    expect(flat).toContain("-i sub.ass");
    expect(flat).toContain("-map 2:s:0");
    expect(flat).toContain("-metadata:s:s:0 title=字幕");
    expect(flat).toContain("-metadata:s:s:0 language=chi");
    expect(flat).toContain("-disposition:s:0 default");
    expect(flat).toContain("-c:s copy");
  });

  it("封面+字幕+章节：输入索引依次递增且章节最后", () => {
    const extras: MergeExtras = {
      coverPath: "c.jpg",
      subtitleTracks: [
        { file: "danmaku.ass", title: "Danmaku", kind: "danmaku" },
        { file: "sub.ass", title: "字幕", language: "chi", kind: "subtitle" },
      ],
      chapterPath: "chapter_t1.txt",
    };
    const argv = buildMergeAudioVideoEx("v.mp4", "a.m4a", "o.mkv", extras);
    const flat = argv.join(" ");
    // 输入顺序：video(0) audio(1) cover(2) danmaku(3) subtitle(4) chapter(5)
    const pos = (name: string): number => argv.indexOf(name);
    expect(pos("v.mp4")).toBeGreaterThanOrEqual(0);
    expect(pos("v.mp4")).toBeLessThan(pos("a.m4a"));
    expect(pos("a.m4a")).toBeLessThan(pos("c.jpg"));
    expect(pos("c.jpg")).toBeLessThan(pos("danmaku.ass"));
    expect(pos("danmaku.ass")).toBeLessThan(pos("sub.ass"));
    expect(pos("sub.ass")).toBeLessThan(pos("chapter_t1.txt"));
    expect(flat).toContain("-map 3:s:0");
    expect(flat).toContain("-map 4:s:0");
    expect(flat).toContain("-disposition:s:0 0");
    expect(flat).toContain("-f ffmetadata");
    expect(flat).toContain("-map_chapters 5");
  });

  it("buildConcatPartsEx：音频可选映射与分片主流", () => {
    const argv = buildConcatPartsEx("lists.txt", "o.mp4", { coverPath: "c.png" });
    expect(argv).toEqual([
      "ffmpeg", "-y",
      "-f", "concat", "-safe", "0",
      "-i", "lists.txt",
      "-i", "c.png",
      "-c:v", "copy",
      "-c:a", "copy",
      "-strict", "unofficial",
      "-map", "0:v:0",
      "-map", "0:a?",
      "-map", "1:v:0",
      "-c:v:1", "png",
      "-disposition:v:1", "attached_pic",
      "-pix_fmt:v:1", "rgba",
      "o.mp4",
    ]);
  });
});

describe("extras/cover 命令构造", () => {
  it("buildCoverConvertArgs 按格式选编码器", () => {
    expect(buildCoverConvertArgs("in.jpg", "out.webp", "webp")).toEqual([
      "ffmpeg", "-y", "-i", "in.jpg", "-c:v", "libwebp", "-frames:v", "1", "out.webp",
    ]);
    expect(buildCoverConvertArgs("in.jpg", "out.avif", "avif")).toContain("libsvtav1");
    expect(buildCoverConvertArgs("in.png", "out.jpg", "jpg")).toContain("mjpeg");
  });

  it("buildAttachCoverToMedia：向已合并媒体追加 attached_pic 轨", () => {
    expect(buildAttachCoverToMedia("m.mp4", "c.jpg", "m2.mp4")).toEqual([
      "ffmpeg", "-y",
      "-i", "m.mp4",
      "-i", "c.jpg",
      "-map", "0",
      "-map", "1:v:0",
      "-c", "copy",
      "-c:v:1", "png",
      "-disposition:v:1", "attached_pic",
      "-pix_fmt:v:1", "rgba",
      "-strict", "unofficial",
      "m2.mp4",
    ]);
  });

  it("coverFileName = stem.format", () => {
    expect(coverFileName("foo", "jpg")).toBe("foo.jpg");
    expect(coverFileName("foo", "webp")).toBe("foo.webp");
  });
});
