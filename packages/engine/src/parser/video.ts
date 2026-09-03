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
    /** 互动视频标记：rights.is_stein_gate === 1（桌面 is_interactive_video 判定） */
    rights?: { is_stein_gate?: number };
    owner?: { mid: number; name: string; face: string };
    pages?: Array<{ cid: number; page: number; part: string; duration: number }>;
    redirect_url?: string;
  };
}

/** view 展开结果：一个稿件 → 其全部分P 的可下载叶子 */
export interface ViewResult {
  /** 稿件主标题 */
  title: string;
  items: MediaItem[];
  /** 内容被重定向（如跳转到番剧）：调用方应改用该地址重新解析 */
  redirectUrl?: string;
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

  const interactive = data.rights?.is_stein_gate === 1;

  return sources.map((s) => {
    const page = s.page > 0 ? s.page : s.fallbackPage;
    return {
      id: `video:${data.bvid}:p${page}`,
      type: "video",
      aid: data.aid,
      bvid: data.bvid,
      cid: s.cid,
      page,
      partCount: pages && pages.length > 0 ? pages.length : 1,
      title: s.part,
      groupTitle: mainTitle,
      duration: s.duration,
      badge,
      cover: data.pic,
      pubtime: data.pubdate,
      owner,
      desc: data.desc,
      url: `https://www.bilibili.com/video/${data.bvid}?p=${page}`,
      ...(interactive ? { interactive: true } : {}),
    };
  });
}

/**
 * 按 bvid/aid 拉取稿件详情（x/web-interface/view）并按分P 展开成叶子条目。
 * VideoParser 与 space/favlist 等"容器行需二次解析"的解析器共用（对应桌面 ReparseWorker 的 view 展开）。
 */
export async function fetchViewItems(
  ctx: ParseContext,
  ident: { bvid?: string; aid?: number },
): Promise<ViewResult> {
  const params: Record<string, string | number | undefined> = {};
  if (ident.bvid !== undefined) params["bvid"] = ident.bvid;
  if (ident.aid !== undefined) params["aid"] = ident.aid;

  const body = await ctx.http.getJSON<ViewResponse>(`${API_BASE}/x/web-interface/view`, {
    params,
  });

  // 内容被重定向（如跳转到番剧/其他视频）：交给上层用 redirect_url 重新解析
  if (body.data?.redirect_url) {
    return { title: "", items: [], redirectUrl: body.data.redirect_url };
  }

  if (body.code !== 0) {
    throw new BiliError("API_ERROR", body.message ?? "view 接口返回错误", {
      apiCode: body.code,
    });
  }
  if (!body.data) {
    throw new BiliError("API_ERROR", "view 接口缺少 data");
  }

  return { title: body.data.title, items: buildItems(body.data) };
}

export class VideoParser implements Parser {
  async parse(ctx: ParseContext, url: string, _options?: ParseOptions): Promise<ParseResult> {
    const { bvid, aid } = bvidOrAidFromUrl(url);
    const ident: { bvid?: string; aid?: number } = {};
    if (bvid !== undefined) ident.bvid = bvid;
    if (aid !== undefined) ident.aid = aid;

    const view = await fetchViewItems(ctx, ident);
    if (view.redirectUrl) {
      return { type: "video", items: [], redirectUrl: view.redirectUrl };
    }
    return {
      type: "video",
      title: view.title,
      items: view.items,
    };
  }
}
