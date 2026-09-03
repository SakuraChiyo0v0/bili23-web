import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BiliError } from "../src/errors.js";
import { mergeAudioVideo, probeMedia, remuxMedia } from "../src/ffmpeg/merge.js";

/** 本机是否有可用的 ffmpeg/ffprobe（CI 镜像内置；无则跳过本文件） */
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

describe.skipIf(!hasFfmpeg())("ffmpeg 合并与探测（真实 ffmpeg）", () => {
  let dir = "";
  let videoFile = "";
  let audioFile = "";

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "bili23-ff-"));
    videoFile = join(dir, "src-v.mp4");
    audioFile = join(dir, "src-a.m4a");
    // 1 秒彩色测试视频 + 1 秒正弦音频，作为合并输入
    run(["ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=duration=1:size=64x64:rate=10", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", videoFile]);
    run(["ffmpeg", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "aac", audioFile]);
  }, 60000);

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("mergeAudioVideo 输出含视频+音频流且可探测", async () => {
    const out = join(dir, "merged.mp4");
    const result = await mergeAudioVideo(videoFile, audioFile, out);
    expect(result.code).toBe(0);
    const info = await probeMedia(out);
    expect(info.streams.length).toBe(2);
    expect(info.streams.some((s) => s.codec_type === "video")).toBe(true);
    expect(info.streams.some((s) => s.codec_type === "audio")).toBe(true);
    expect(info.duration).toBeGreaterThan(0.5);
    expect(info.duration).toBeLessThan(2.5);
  }, 30000);

  it("remuxMedia 单视频流拷贝转封装", async () => {
    const out = join(dir, "remuxed.mp4");
    const result = await remuxMedia(videoFile, out);
    expect(result.code).toBe(0);
    const info = await probeMedia(out);
    expect(info.streams.some((s) => s.codec_type === "video")).toBe(true);
  }, 30000);

  it("输入文件缺失：抛 MERGE_FAILED", async () => {
    await expect(
      mergeAudioVideo(join(dir, "nope.mp4"), audioFile, join(dir, "x.mp4")),
    ).rejects.toMatchObject({ code: "MERGE_FAILED" });
  }, 30000);

  it("探测不存在的文件：抛 MERGE_FAILED", async () => {
    await expect(probeMedia(join(dir, "missing.mp4"))).rejects.toMatchObject({
      code: "MERGE_FAILED",
    });
  }, 30000);
});

