import { BiliError } from "../errors.js";
import type { ParseContext, ParseResult, Parser } from "./types.js";

/**
 * 活动页解析器（bilibili.com/festival/...）。
 * 语义对齐桌面 parser/festival.py：
 * - 拉取活动页 HTML，抓取 window.__INITIAL_STATE__ 里的 JSON
 * - 取其 videoInfo.bvid 还原成投稿视频地址，交由调用方重新解析（redirectUrl）
 */
export class FestivalParser implements Parser {
  async parse(ctx: ParseContext, url: string): Promise<ParseResult> {
    let html: string;
    try {
      html = await ctx.http.getText(url);
    } catch (err) {
      throw new BiliError("INVALID_URL", "活动页请求失败", { cause: err });
    }
    const match = /window\.__INITIAL_STATE__\s*=\s*(\{.*?\});/s.exec(html);
    if (!match?.[1]) {
      throw new BiliError("INVALID_URL", "无法从活动页解析初始状态");
    }
    let info: { videoInfo?: { bvid?: string } } = {};
    try {
      info = JSON.parse(match[1]) as { videoInfo?: { bvid?: string } };
    } catch (err) {
      throw new BiliError("INVALID_URL", "活动页 JSON 解析失败", { cause: err });
    }
    const bvid = info.videoInfo?.bvid;
    if (!bvid) {
      throw new BiliError("INVALID_URL", "活动页未找到视频");
    }
    return { type: "video", items: [], redirectUrl: `https://www.bilibili.com/video/${bvid}` };
  }
}
