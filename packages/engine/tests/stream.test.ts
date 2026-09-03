import { describe, expect, it } from "vitest";
import { BiliError } from "../src/errors.js";
import type { StreamRef, VideoMediaInfo } from "../src/media/video-info.js";
import {
  AUTO_AUDIO_QUALITY,
  AUTO_CODEC,
  AUTO_QUALITY,
  resolveStreams,
} from "../src/stream/resolver.js";

function stream(id: number, codecid: number, url: string, extra: Partial<StreamRef> = {}): StreamRef {
  return { id, codecid, baseUrl: url, backupUrl: [], bandwidth: 0, mimeType: "", codecs: "", ...extra };
}

/** 断言调用会抛出 DOWNLOAD_FAILED（BiliError 统一错误码） */
function expectDownloadFailed(fn: () => void): void {
  let threw = false;
  try {
    fn();
  } catch (e) {
    threw = true;
    expect(e).toBeInstanceOf(BiliError);
    expect((e as BiliError).code).toBe("DOWNLOAD_FAILED");
  }
  if (!threw) {
    throw new Error("期望抛出 DOWNLOAD_FAILED 但没有抛出");
  }
}

function makeInfo(partial: Partial<VideoMediaInfo>): VideoMediaInfo {
  return {
    mediaType: "dash",
    timelength: 0,
    qualities: [],
    videoByQuality: {},
    audioList: [],
    audioQualities: [],
    mp4Qualities: [],
    mp4QualityLabel: {},
    ...partial,
  };
}

/** 常规 DASH 投稿视频：8K(av1/hevc) + 1080P(avc/hevc) + 720P(avc)，音频 192K/132K/64K */
function dashInfo(): VideoMediaInfo {
  return makeInfo({
    mediaType: "dash",
    timelength: 213000,
    qualities: [127, 80, 64],
    videoByQuality: {
      127: {
        13: stream(127, 13, "https://up/v127-av1.m4s"),
        12: stream(127, 12, "https://up/v127-hevc.m4s"),
      },
      80: {
        12: stream(80, 12, "https://up/v80-hevc.m4s"),
        7: stream(80, 7, "https://up/v80-avc.m4s"),
      },
      64: {
        7: stream(64, 7, "https://up/v64-avc.m4s"),
      },
    },
    audioList: [
      stream(30280, 0, "https://up/a192.m4s"),
      stream(30232, 0, "https://up/a132.m4s"),
      stream(30216, 0, "https://up/a64.m4s"),
    ],
    audioQualities: [30280, 30232, 30216],
  });
}

describe("resolveStreams · DASH 自动选择", () => {
  it("auto：画质按优先级取最高可用，编码按优先级回退，音质按优先级取最高", () => {
    const resolved = resolveStreams(dashInfo(), {});
    expect(resolved.mediaType).toBe("dash");
    expect(resolved.videoQualityId).toBe(127);
    // 127 只有 AV1/HEVC：编码优先级 [7,12,13] 命中 12
    expect(resolved.videoCodecId).toBe(12);
    expect(resolved.videoRef?.baseUrl).toBe("https://up/v127-hevc.m4s");
    expect(resolved.audioQualityId).toBe(30280);
    expect(resolved.audioRef?.baseUrl).toBe("https://up/a192.m4s");
    expect(resolved.videoExt).toBe("m4s");
  });

  it("auto：最高画质缺 AVC 时回退；存在 AVC 时优先 AVC", () => {
    const info = dashInfo();
    // 只看 1080P/720P 两级，1080P 提供 AVC+HEVC
    info.qualities = [80, 64];
    info.videoByQuality = {
      80: {
        12: stream(80, 12, "https://up/v80-hevc.m4s"),
        7: stream(80, 7, "https://up/v80-avc.m4s"),
      },
      64: { 7: stream(64, 7, "https://up/v64-avc.m4s") },
    };
    const resolved = resolveStreams(info, {});
    expect(resolved.videoQualityId).toBe(80);
    expect(resolved.videoCodecId).toBe(7);
    expect(resolved.videoRef?.baseUrl).toBe("https://up/v80-avc.m4s");
  });

  it("auto：自定义优先级可覆盖默认顺序", () => {
    const resolved = resolveStreams(dashInfo(), {
      videoQualityPriority: [64, 127],
      videoCodecPriority: [13, 12, 7],
      audioQualityPriority: [30216, 30280],
    });
    expect(resolved.videoQualityId).toBe(64);
    expect(resolved.videoCodecId).toBe(7); // 64 只有 AVC
    expect(resolved.audioQualityId).toBe(30216);
  });

  it("auto：音质传桌面语义的 30300 同样视为自动", () => {
    const resolved = resolveStreams(dashInfo(), { audioQualityId: 30300 });
    expect(resolved.audioQualityId).toBe(30280);
  });
});

describe("resolveStreams · DASH 显式指定", () => {
  it("显式画质可用：锁定该画质并自动选编码", () => {
    const resolved = resolveStreams(dashInfo(), { videoQualityId: 80 });
    expect(resolved.videoQualityId).toBe(80);
    expect(resolved.videoCodecId).toBe(7);
    expect(resolved.videoRef?.baseUrl).toBe("https://up/v80-avc.m4s");
  });

  it("显式画质+编码可用：精确命中", () => {
    const resolved = resolveStreams(dashInfo(), { videoQualityId: 80, videoCodecId: 12 });
    expect(resolved.videoQualityId).toBe(80);
    expect(resolved.videoCodecId).toBe(12);
    expect(resolved.videoRef?.codecid).toBe(12);
  });

  it("显式画质不可用：回退到可用列表第一位（最高画质）", () => {
    const resolved = resolveStreams(dashInfo(), { videoQualityId: 116 });
    expect(resolved.videoQualityId).toBe(127);
  });

  it("显式编码不可用：回退到该画质第一个编码", () => {
    const resolved = resolveStreams(dashInfo(), { videoQualityId: 127, videoCodecId: 7 });
    // JS 对象整数键按数值升序枚举：{13,12} 的 Object.keys 为 [12,13]，回退取 12
    expect(resolved.videoCodecId).toBe(12);
  });

  it("显式音质可用：精确命中", () => {
    const resolved = resolveStreams(dashInfo(), { audioQualityId: 30232 });
    expect(resolved.audioQualityId).toBe(30232);
    expect(resolved.audioRef?.baseUrl).toBe("https://up/a132.m4s");
  });

  it("显式音质不可用：禁用音频（对齐桌面清掉 AUDIO 位）", () => {
    const resolved = resolveStreams(dashInfo(), { audioQualityId: 30250 });
    expect(resolved.audioQualityId).toBe(AUTO_AUDIO_QUALITY);
    expect(resolved.audioRef).toBeUndefined();
  });
});

describe("resolveStreams · DASH 异常与缺音频", () => {
  it("没有任何可用画质：抛 DOWNLOAD_FAILED", () => {
    const info = dashInfo();
    info.qualities = [];
    info.videoByQuality = {};
    expectDownloadFailed(() => resolveStreams(info, {}));
  });

  it("画质无对应编码流：抛 DOWNLOAD_FAILED", () => {
    const info = dashInfo();
    info.qualities = [80];
    info.videoByQuality = {};
    expectDownloadFailed(() => resolveStreams(info, {}));
  });

  it("音频池为空：仍返回视频流，audio 为空", () => {
    const info = dashInfo();
    info.audioList = [];
    info.audioQualities = [];
    const resolved = resolveStreams(info, {});
    expect(resolved.videoRef).toBeDefined();
    expect(resolved.audioRef).toBeUndefined();
    expect(resolved.audioQualityId).toBe(AUTO_AUDIO_QUALITY);
  });

  it("音频池不含任何优先级命中档（仅 30255 罕见档）：禁用音频", () => {
    const info = dashInfo();
    info.audioList = [stream(30255, 0, "https://up/a30255.m4s")];
    info.audioQualities = [30255];
    const resolved = resolveStreams(info, {});
    expect(resolved.audioRef).toBeUndefined();
  });
});

describe("resolveStreams · MP4/FLV 直链", () => {
  function mp4Info(): VideoMediaInfo {
    return makeInfo({
      mediaType: "mp4",
      timelength: 60000,
      mp4Qualities: [64, 32, 16],
      mp4QualityLabel: { 64: "720P", 32: "480P", 16: "360P" },
      durl: [
        { order: 1, url: "https://up/v1.mp4", backupUrl: ["https://up2/v1.mp4"], size: 1000, length: 60000 },
      ],
    });
  }

  it("auto：画质按优先级命中，返回 durl 分片且无音频", () => {
    const resolved = resolveStreams(mp4Info(), {});
    expect(resolved.mediaType).toBe("mp4");
    expect(resolved.videoQualityId).toBe(64);
    expect(resolved.videoCodecId).toBe(7);
    expect(resolved.audioQualityId).toBe(AUTO_AUDIO_QUALITY);
    expect(resolved.durl?.length).toBe(1);
    expect(resolved.durl?.[0]?.url).toBe("https://up/v1.mp4");
    expect(resolved.videoExt).toBe("mp4");
  });

  it("显式画质不可用：回退到直链可用列表第一位", () => {
    const resolved = resolveStreams(mp4Info(), { videoQualityId: 80 });
    expect(resolved.videoQualityId).toBe(64);
  });

  it("没有任何直链分片：抛 DOWNLOAD_FAILED", () => {
    const info = mp4Info();
    info.durl = [];
    expectDownloadFailed(() => resolveStreams(info, {}));
  });
});


