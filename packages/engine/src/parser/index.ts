import { BiliError } from "../errors.js";
import { classifyUrl, type ContentType } from "../url.js";
import { VideoParser } from "./video.js";
import type { Parser, ParseContext, ParseResult } from "./types.js";

/** b23 短链最多跟随跳转次数 */
const MAX_REDIRECT_HOPS = 3;

/** 按内容类型取解析器；未实现的类型抛 UNSUPPORTED_TYPE（P2 起逐个注册） */
export function getParser(type: ContentType): Parser {
  switch (type) {
    case "video":
      return new VideoParser();
    default:
      throw new BiliError("UNSUPPORTED_TYPE", `暂不支持的解析类型：${type}`);
  }
}

/**
 * 统一解析入口：识别链接 →（b23 短链先解跳转）→ 按类型分发。
 * 语义对应桌面版 ParseWorker：一个链接解析出一棵条目列表。
 */
export async function parseUrl(ctx: ParseContext, raw: string): Promise<ParseResult> {
  let url = raw.trim();
  if (!url) throw new BiliError("INVALID_URL", "链接为空");

  for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop += 1) {
    const { type } = classifyUrl(url);
    if (type === "unknown") {
      throw new BiliError("INVALID_URL", `无法识别的链接：${url}`);
    }
    if (type === "b23") {
      url = await ctx.http.getRedirect(url);
      continue;
    }
    return getParser(type).parse(ctx, url);
  }

  throw new BiliError("INVALID_URL", "短链跳转次数超限");
}
