import { describe, expect, it } from "vitest";
import {
  VIDEO_QUALITY,
  REVERSED_VIDEO_QUALITY,
  AUDIO_QUALITY,
  VIDEO_CODEC,
  VIDEO_CODEC_STR,
  videoQualityLabel,
  audioQualityLabel,
} from "../src/constants/quality.js";

describe("quality constants（对齐桌面 media_info.py）", () => {
  it("画质映射数值正确", () => {
    expect(VIDEO_QUALITY.AUTO).toBe(200);
    expect(VIDEO_QUALITY["8K"]).toBe(127);
    expect(VIDEO_QUALITY.DOLBY_VISION).toBe(126);
    expect(VIDEO_QUALITY.HDR).toBe(125);
    expect(VIDEO_QUALITY["4K_SDR"]).toBe(122);
    expect(VIDEO_QUALITY["4K"]).toBe(120);
    expect(VIDEO_QUALITY["1080P60"]).toBe(116);
    expect(VIDEO_QUALITY["1080P+"]).toBe(112);
    expect(VIDEO_QUALITY.AI).toBe(100);
    expect(VIDEO_QUALITY["1080P"]).toBe(80);
    expect(VIDEO_QUALITY["720P"]).toBe(64);
    expect(VIDEO_QUALITY["480P"]).toBe(32);
    expect(VIDEO_QUALITY["360P"]).toBe(16);
  });

  it("反向画质映射可查标签", () => {
    expect(REVERSED_VIDEO_QUALITY[80]).toBe("1080P");
    expect(videoQualityLabel(80)).toBe("1080P");
    expect(videoQualityLabel(999)).toMatch(/画质/);
  });

  it("音质映射数值正确", () => {
    expect(AUDIO_QUALITY.AUTO).toBe(30300);
    expect(AUDIO_QUALITY.HI_RES).toBe(30251);
    expect(AUDIO_QUALITY.DOLBY_ATMOS).toBe(30250);
    expect(AUDIO_QUALITY["192K"]).toBe(30280);
    expect(AUDIO_QUALITY["132K"]).toBe(30232);
    expect(AUDIO_QUALITY["64K"]).toBe(30216);
    expect(audioQualityLabel(30251)).toBe("HI_RES");
  });

  it("视频编码映射正确", () => {
    expect(VIDEO_CODEC["AVC/H.264"]).toBe(7);
    expect(VIDEO_CODEC["HEVC/H.265"]).toBe(12);
    expect(VIDEO_CODEC.AV1).toBe(13);
    expect(VIDEO_CODEC.AUTO).toBe(20);
    expect(VIDEO_CODEC_STR[7]).toBe("AVC");
    expect(VIDEO_CODEC_STR[12]).toBe("HEVC");
    expect(VIDEO_CODEC_STR[13]).toBe("AV1");
  });
});
