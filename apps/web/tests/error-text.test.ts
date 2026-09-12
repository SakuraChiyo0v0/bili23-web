import { describe, expect, it } from "vitest";
import { DIR_INVALID_TEXT, FFMPEG_MISSING_TEXT, friendlyDownloadError } from "../src/server/error-text.js";

/**
 * 错误文案改写（原版 F12/F13 的长提示）。
 * 关键判据不是"认识的错误要改写"，而是**不认识的错误绝不能吞掉**。
 */
describe("friendlyDownloadError", () => {
  it("目录不可写 → 原版那句（并保留原始错误）", () => {
    const out = friendlyDownloadError("EACCES: permission denied, open '/data/downloads/x.m4s'");
    expect(out).toContain(DIR_INVALID_TEXT);
    expect(out).toContain("EACCES");
  });

  it("目录不存在/只读/没空间 → 同一句", () => {
    for (const raw of [
      "ENOENT: no such file or directory, mkdir '/data/downloads'",
      "EROFS: read-only file system, write '/data/downloads'",
      "ENOSPC: no space left on device, write",
    ]) {
      expect(friendlyDownloadError(raw)).toContain(DIR_INVALID_TEXT);
    }
  });

  it("FFmpeg 缺失 → 可执行的建议（并保留原始错误）", () => {
    const out = friendlyDownloadError("spawn ffmpeg ENOENT");
    expect(out).toContain(FFMPEG_MISSING_TEXT);
    expect(out).toContain("spawn ffmpeg ENOENT");
  });

  it("**不认识的错误原样返回**（不吞信息、不误判）", () => {
    const raw = "解析失败：接口返回 code=-404";
    expect(friendlyDownloadError(raw)).toBe(raw);
    // ENOENT 但没有目录/写盘字样 → 不能当成目录问题
    const stray = "ENOENT: 分片临时文件不存在";
    expect(friendlyDownloadError(stray)).toBe(stray);
  });

  it("ffmpeg 相关但**不是缺失**（例如编码失败）不改写", () => {
    const raw = "ffmpeg 退出码 1：Unknown encoder 'libx264'";
    expect(friendlyDownloadError(raw)).toBe(raw);
  });
});
