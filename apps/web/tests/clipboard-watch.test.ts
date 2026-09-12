import { describe, expect, it } from "vitest";
import { detectBiliLink } from "../src/client/lib/clipboardWatch.js";

/**
 * 剪贴板监控的**纯逻辑**部分（Web 改写版：聚焦时读一次，命中只填入不自动解析）。
 * 这里钉住"什么算 B 站链接/编号"与"标点清洗"。
 */
describe("detectBiliLink", () => {
  it("完整 URL", () => {
    expect(detectBiliLink("https://www.bilibili.com/video/BV1xZMU6TE1X")).toBe("https://www.bilibili.com/video/BV1xZMU6TE1X");
    expect(detectBiliLink("https://space.bilibili.com/9064879/video")).toBe("https://space.bilibili.com/9064879/video");
    expect(detectBiliLink("https://b23.tv/abc123")).toBe("https://b23.tv/abc123");
  });

  it("无协议形态也能识别", () => {
    expect(detectBiliLink("www.bilibili.com/video/BV1xZMU6TE1X")).toBe("www.bilibili.com/video/BV1xZMU6TE1X");
  });

  it("裸号码 / 编号", () => {
    expect(detectBiliLink("BV1xZMU6TE1X")).toBe("BV1xZMU6TE1X");
    expect(detectBiliLink("看看这个 av12345")).toBe("av12345");
    expect(detectBiliLink("ep123456")).toBe("ep123456");
  });

  it("带中文标点尾巴时会清掉（复制来的链接常见）", () => {
    expect(detectBiliLink("https://www.bilibili.com/video/BV1xZMU6TE1X，")).toBe("https://www.bilibili.com/video/BV1xZMU6TE1X");
    expect(detectBiliLink("（https://b23.tv/abc123）")).toBe("https://b23.tv/abc123");
  });

  it("从一大段文字里挑出链接", () => {
    expect(detectBiliLink("分享一个视频 https://www.bilibili.com/video/BV1xZMU6TE1X 很好笑")).toBe("https://www.bilibili.com/video/BV1xZMU6TE1X");
  });

  it("不是 B 站内容 → undefined（不误触）", () => {
    expect(detectBiliLink("https://www.youtube.com/watch?v=abc")).toBeUndefined();
    expect(detectBiliLink("这是一段普通文字")).toBeUndefined();
    expect(detectBiliLink("")).toBeUndefined();
    expect(detectBiliLink(undefined)).toBeUndefined();
    expect(detectBiliLink(null)).toBeUndefined();
  });
});
