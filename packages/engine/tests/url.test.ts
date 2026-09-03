import { describe, expect, it } from "vitest";
import { classifyUrl } from "../src/url.js";

describe("classifyUrl", () => {
  it("识别投稿视频域名链接", () => {
    expect(classifyUrl("https://www.bilibili.com/video/BV1xx411c7mD")).toEqual({
      type: "video",
      token: "BV1xx411c7mD",
    });
  });

  it("识别裸 BV 串（桌面兜底模式）", () => {
    expect(classifyUrl("BV1xx411c7mD")).toEqual({ type: "video", token: "BV1xx411c7mD" });
  });

  it("识别番剧 ep/ss/md", () => {
    expect(classifyUrl("https://www.bilibili.com/bangumi/play/ep123456")).toEqual({
      type: "bangumi",
      token: "ep123456",
    });
    expect(classifyUrl("https://www.bilibili.com/bangumi/play/ss12345")).toEqual({
      type: "bangumi",
      token: "ss12345",
    });
    expect(classifyUrl("https://www.bilibili.com/bangumi/media/md28223077")).toEqual({
      type: "bangumi",
      token: "md28223077",
    });
    expect(classifyUrl("ep123456")).toEqual({ type: "bangumi", token: "ep123456" });
  });

  it("识别课程 cheese", () => {
    expect(classifyUrl("https://www.bilibili.com/cheese/play/ep123456")).toEqual({
      type: "cheese",
      token: "ep123456",
    });
  });

  it("识别音乐 au/am", () => {
    expect(classifyUrl("https://www.bilibili.com/audio/au123456")).toEqual({
      type: "audio",
      token: "au123456",
    });
    expect(classifyUrl("am123456")).toEqual({ type: "audio", token: "am123456" });
  });

  it("识别 UP 主空间（先于通用空间规则）", () => {
    expect(classifyUrl("https://space.bilibili.com/1234567")).toEqual({
      type: "space",
      token: "1234567",
    });
  });

  it("识别合集 lists 与收藏夹 favlist 优先级", () => {
    expect(classifyUrl("https://space.bilibili.com/1234567/lists")).toEqual({
      type: "list",
      token: "1234567",
    });
    expect(classifyUrl("https://space.bilibili.com/1234567/favlist")).toEqual({
      type: "favlist",
      token: "1234567",
    });
    expect(classifyUrl("https://www.bilibili.com/list/ml123456")).toEqual({
      type: "favlist",
      token: "123456",
    });
  });

  it("识别 b23 短链", () => {
    expect(classifyUrl("https://b23.tv/abc123")).toEqual({ type: "b23", token: "b23.tv" });
  });

  it("未知链接返回 unknown", () => {
    expect(classifyUrl("https://example.com/whatever")).toEqual({ type: "unknown", token: "" });
  });
});

