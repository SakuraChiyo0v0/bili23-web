import { BiliError } from "../errors.js";
import { classifyUrl } from "../url.js";
import type { MediaItem } from "../types.js";
import type { ParseContext, ParseOptions, ParseResult, Parser } from "./types.js";

/** B 站 Web API 基址 */
export const API_BASE = "https://api.bilibili.com";

/** view 接口响应（仅声明本模块用到的字段） */
interface ViewResponse {
  code: number;
  message?: string;
  data?: {
    bvid: string;
    aid: number;
    cid: number;
    title: string;
    pic: string;
    duration: number;
    pubdate: number;
    desc: string;
    is_upower_exclusive?: boolean;
    owner?: { mid: number; name: string; face: string };
    pages?: Array<{ cid: number; page: number; part: string; duration: number }>;
    redirect_url?: string;
  };
}

function bvidOrAidFromUrl(raw: string): { bvid?: string; aid?: number } {
  const { type, token } = classifyUrl(raw);
  if (type !== "video") {
    throw new BiliError("INVALID_URL", "不是投稿视频链接");
  }
  if (/^BV/i.test(token)) return { bvid: token };
  const aidStr = token.replace(/^av/i, "");
  const aid = Number(aidStr);
  if (!Number.isFinite(aid) || aid <= 0) {
    throw new BiliError("INVALID_URL", `无法从链接中识别视频 id：${token}`);
  }
  return { aid };
}

function buildItems(data: NonNullable<ViewResponse["data"]>): MediaItem[] {
  const owner = data.owner ?? { mid: 0, name: "", face: "" };
  const badge = data.is_upower_exclusive ? "充电专属" : "";
  const mainTitle = data.title;
  const pages = data.pages;

  const sources =
    pages && pages.length > 0
      ? pages.map((p, index) => ({
          page: p.page,
          cid: p.cid,
          part: p.part,
          duration: p.duration,
          fallbackPage: index + 1,
        }))
      : [
          {
            page: 1,
            cid: data.cid,
            part: data.title,
            duration: data.duration,
            fallbackPage: 1,
          },
        ];

  return sources.map((s) => {
    const page = s.page > 0 ? s.page : s.fallbackPage;
    return {
      id: `video:${data.bvid}:p${page}`,
      type: "video",
      aid: data.aid,
      bvid: data.bvid,
      cid: s.cid,
      page,
      title: s.part,
      groupTitle: mainTitle,
      duration: s.duration,
      badge,
      cover: data.pic,
      pubtime: data.pubdate,
      owner,
      desc: data.desc,
      url: `https://www.bilibili.com/video/${data.bvid}?p=${page}`,
    };
  });
}

export class VideoParser implements Parser {
  async parse(ctx: ParseContext, url: string, _options?: ParseOptions): Promise<ParseResult> {
    const { bvid, aid } = bvidOrAidFromUrl(url);

    const params: Record<string, string | number | undefined> = {};
    if (bvid) params["bvid"] = bvid;
    if (aid !== undefined) params["aid"] = aid;

    const body = await ctx.http.getJSON<ViewResponse>(`${API_BASE}/x/web-interface/view`, {
      params,
    });

    // 内容被重定向（如跳转到番剧/其他视频）：交给上层用 redirect_url 重新解析
    if (body.data?.redirect_url) {
      return { type: "video", items: [], redirectUrl: body.data.redirect_url };
    }

    if (body.code !== 0) {
      throw new BiliError("API_ERROR", body.message ?? "view 接口返回错误", {
        apiCode: body.code,
      });
    }
    if (!body.data) {
      throw new BiliError("API_ERROR", "view 接口缺少 data");
    }

    const items = buildItems(body.data);
    return {
      type: "video",
      title: body.data.title,
      items,
    };
  }
}
