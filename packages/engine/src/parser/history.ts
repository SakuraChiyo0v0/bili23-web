import { BiliError } from "../errors.js";
import { classifyUrl } from "../url.js";
import { isLoginApiError } from "../media/video-info.js";
import { API_BASE } from "./video.js";
import { expandVideoRows } from "./expand.js";
import { requireLogin } from "./guard.js";
import type { ParseContext, ParseOptions, ParseResult, Parser } from "./types.js";

/**
 * 观看历史解析器（bili23://history，?keyword= 搜索）。
 * 语义对齐桌面 parser/history.py + episode/history.py：
 * - 需登录（无 SESSDATA 前置抛 LOGIN_REQUIRED，不发请求）
 * - 列表走 x/web-interface/history/search（明文 GET，business=archive 只取投稿，ps=20）
 * - 桌面行带 bvid/cid 但仍标 NEED_PARSE（按 bvid 二次解析展开全部分P）；Web 沿用
 *   展开语义：archive 行并发 view 平铺分P；duration=0 的过期行若 view 已失效自然跳过
 */

const PAGE_SIZE = 20;

interface HistoryRow {
  history?: { bvid?: string; cid?: number; epid?: number; business?: string };
  title?: string;
  cover?: string;
  duration?: number;
  badge?: string;
  view_at?: number;
  uri?: string;
}

interface HistoryData {
  page?: { total?: number };
  list?: HistoryRow[] | null;
}

interface HistoryResponse {
  code: number;
  message?: string;
  data?: HistoryData;
}

function keywordFromUrl(raw: string): string {
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    return (new URL(withScheme).searchParams.get("keyword") ?? "").trim();
  } catch {
    return "";
  }
}

function assertHistoryOk(body: HistoryResponse): void {
  if (body.code !== 0) {
    if (isLoginApiError(body.code, body.message)) {
      throw new BiliError("LOGIN_REQUIRED", body.message ?? "需要登录后查看历史记录", { apiCode: body.code });
    }
    throw new BiliError("API_ERROR", body.message ?? "历史记录接口返回错误", { apiCode: body.code });
  }
}

export class HistoryParser implements Parser {
  async parse(ctx: ParseContext, url: string, options?: ParseOptions): Promise<ParseResult> {
    const { type } = classifyUrl(url);
    if (type !== "history") throw new BiliError("INVALID_URL", "不是历史记录链接");
    requireLogin(ctx, "历史记录");

    const keyword = keywordFromUrl(url);
    const pn =
      options?.pn !== undefined && Number.isFinite(options.pn)
        ? Math.max(1, Math.floor(options.pn))
        : 1;

    const body = await ctx.http.getJSON<HistoryResponse>(`${API_BASE}/x/web-interface/history/search`, {
      params: {
        pn,
        ps: PAGE_SIZE,
        keyword,
        business: "archive",
        add_time_start: 0,
        add_time_end: 0,
        arc_max_duration: 0,
        arc_min_duration: 0,
        device_type: 0,
        web_location: "***.****",
      },
    });
    assertHistoryOk(body);
    const videoRows = (body.data?.list ?? []).flatMap((r) =>
      r.history && r.history.business === "archive" && r.history.bvid ? [{ bvid: r.history.bvid }] : [],
    );

    const items = await expandVideoRows(ctx, videoRows);

    return { type: "history", items, ...(keyword ? { title: `搜索“${keyword}”` } : {}) };
  }
}