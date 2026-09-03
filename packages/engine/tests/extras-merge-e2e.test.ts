import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mergeAudioVideo, probeMedia } from "../src/ffmpeg/merge.js";
import type { SubtitleTrackSpec } from "../src/ffmpeg/command.js";

function hasFfmpeg(): boolean {
  try {
    const r = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return r.status === 0;
  } catch {
    return false;
  }
}

function run(args: string[]): void {
  const r = spawnSync(args[0] as string, args.slice(1), { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`命令失败 ${args.join(" ")}: ${r.stderr}`);
  }
}

interface ChapterInfo {
  start_time?: number;
  end_time?: number;
  tags?: { title?: string };
}

function probeChapters(filePath: string): ChapterInfo[] {
  const r = spawnSync(
    "ffprobe",
    ["-v", "error", "-print_format", "json", "-show_chapters", filePath],
    { encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error(`ffprobe 章节失败: ${r.stderr}`);
  const json = JSON.parse(r.stdout) as { chapters?: ChapterInfo[] };
  return json.chapters ?? [];
}

describe.skipIf(!hasFfmpeg())("附加内容内嵌（真实 ffmpeg E2E）", () => {
  let dir = "";
  let video = "";
  let audio = "";
  let cover = "";
  let ass = "";
  let chapter = "";

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "bili23-extras-"));
    video = join(dir, "v.mp4");
    audio = join(dir, "a.m4a");
    cover = join(dir, "cover.png");
    ass = join(dir, "sub.ass");
    chapter = join(dir, "chapter.txt");
    run(["ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=duration=1:size=64x64:rate=10", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", video]);
    run(["ffmpeg", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "aac", audio]);
    run(["ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=red:size=64x64", "-frames:v", "1", cover]);
    const assBody = [
      "[Script Info]",
      "ScriptType: v4.00+",
      "",
      "[V4+ Styles]",
      "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
      "Style: Default,黑体,36,&H00FFFFFF,&H000000FF,H00000000,H00000000,0,0,0,0,100,100,0,0,1,1.0,0.0,2,10,10,20,1",
      "",
      "[Events]",
      "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
      "Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,hello",
      "",
    ].join("\n");
    await writeFile(ass, assBody, "utf8");
    await writeFile(
      chapter,
      [
        ";FFMETADATA1",
        "",
        "[CHAPTER]",
        "TIMEBASE=1/1000",
        "START=0",
        "END=1000",
        "title=Intro",
        "",
      ].join("\n"),
      "utf8",
    );
  }, 60000);

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("MKV 合并内嵌封面 + ASS 字幕轨 + 章节", async () => {
    const out = join(dir, "out.mkv");
    const tracks: SubtitleTrackSpec[] = [
      { file: "sub.ass", title: "字幕", language: "chi", kind: "subtitle" },
    ];
    const result = await mergeAudioVideo("v.mp4", "a.m4a", "out.mkv", {
      cwd: dir,
      container: "mkv",
      coverPath: "cover.png",
      chapterPath: "chapter.txt",
      subtitleTracks: tracks,
    });
    expect(result.code).toBe(0);

    const info = await probeMedia(out);
    expect(info.streams.length).toBeGreaterThanOrEqual(3);
    const subtitle = info.streams.find((s) => s.codec_type === "subtitle");
    expect(subtitle?.codec_name).toBe("ass");
    const attached = info.streams.find((s) => s.codec_type === "video" && s.width === 64);
    expect(attached).toBeDefined();

    const chapters = probeChapters(out);
    expect(chapters).toHaveLength(1);
    expect(chapters[0]?.tags?.title).toBe("Intro");
  }, 60000);

  it("非 MKV（mp4）时字幕轨不内嵌（resolveEmbeddableTracks 语义）", async () => {
    const out = join(dir, "out-mp4.mp4");
    const result = await mergeAudioVideo("v.mp4", "a.m4a", "out-mp4.mp4", {
      cwd: dir,
      container: "mp4",
      coverPath: "cover.png",
      chapterPath: "chapter.txt",
      subtitleTracks: [{ file: "sub.ass", title: "字幕", kind: "subtitle" }],
    });
    expect(result.code).toBe(0);
    const info = await probeMedia(out);
    expect(info.streams.some((s) => s.codec_type === "subtitle")).toBe(false);
  }, 60000);
});
