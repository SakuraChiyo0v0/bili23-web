import { describe, expect, it } from "vitest";
import { CODEC_NOTE, estimateSize, fmtBitrate, fmtFileSize, fmtFrameRate, noAudioReason } from "../src/client/lib/mediaText.js";

describe("媒体信息卡的单位格式化（原版 util/format/units.py）", () => {
  it("文件大小：1024 进制、两位小数（与任务卡的取整规则刻意不同）", () => {
    expect(fmtFileSize(1024)).toBe("1.00 KB");
    expect(fmtFileSize(1536)).toBe("1.50 KB");
    expect(fmtFileSize(1024 * 1024 * 12.345)).toBe("12.35 MB");
    expect(fmtFileSize(512)).toBe("512.00 B");
    expect(fmtFileSize(0)).toBe("");
  });

  it("码率：1000 进制", () => {
    expect(fmtBitrate(192000)).toBe("192.0 Kbps");
    expect(fmtBitrate(4_500_000)).toBe("4.5 Mbps");
    expect(fmtBitrate(999)).toBe("999 bps");
    expect(fmtBitrate(0)).toBe("");
  });

  it("帧率：一位小数 + fps（原版 format_frame_rate）", () => {
    expect(fmtFrameRate("60")).toBe("60.0 fps");
    expect(fmtFrameRate(29.97)).toBe("30.0 fps");
    expect(fmtFrameRate(undefined)).toBe("");
    expect(fmtFrameRate("abc")).toBe("");
  });

  it("编码说明：7/12/13 三条（原版 get_codec_tip）", () => {
    expect(CODEC_NOTE[7]).toBe("文件体积大，兼容性强");
    expect(CODEC_NOTE[12]).toBe("文件体积小，但兼容性较差");
    expect(CODEC_NOTE[13]).toBe("压缩效率最高，但兼容性最差");
    expect(CODEC_NOTE[99]).toBeUndefined();
  });

  it("无音轨原因按媒体类型分派", () => {
    expect(noAudioReason("dash")).toBe("无声视频流，不包含音轨");
    expect(noAudioReason("mp4")).toBe("视频流中已包含音轨");
    expect(noAudioReason(undefined)).toBe("将按优先级自动选择音质");
  });

  it("估大小：有真实 size 就用它，否则按码率×时长估算", () => {
    expect(estimateSize(2048, 999999, 1000)).toBe("2.00 KB");     // 真实 size 优先
    expect(estimateSize(undefined, 8_000_000, 10_000)).toBe("9.54 MB"); // 8Mbps × 10s / 8
    expect(estimateSize(undefined, 0, 10_000)).toBe("");           // 没码率就留空，不硬编
    expect(estimateSize(undefined, 8_000_000, 0)).toBe("");
  });
});
