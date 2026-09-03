import { BiliError } from "../errors.js";
import { wbiSign } from "../api/wbi.js";
import { ensureWbiKeys } from "../media/wbi-keys.js";
import { classifyUrl } from "../url.js";
import { isLoginApiError } from "../media/video-info.js";
import { API_BASE } from "./video.js";
import { expandVideoRows } from "./expand.js";
import { requireLogin } from "./guard.js";
import type { MediaItem } from "../types.js";
import type { ParseContext, ParseOptions, ParseResult, Parser } from "./types.js";

/**
 * 稍后再看解析器（bili23://watch_later，?key= 搜索）。
 * 语义对齐桌面 parser/watch_later.py + episode/watch_later.py：
 * - 需登录（无 SESSDATA 前置抛 LOGIN_REQUIRED，不发请求）
 * - 列表走 x/v2/history/toview/web（WBI 签名，ps=20，搜索参数名是 key）
 * - 桌面行带 bvid/cid 但仍标 NEED_PARSE（按 bvid 二次解析展开全部分P）；
 *   Web 沿用展开语义：archive 行并发 view 平铺分P；bangumi 行直接映射为单集
 *   番剧叶子（pgc flavor 只依赖 bvid+cid，见计划记录）
 */

const PAGE_SIZE = 20;

interface ToviewRow {
  aid?: number;
  bvid?: string;
  cid?: number;
  pic?: string;
  title?: string;
  pubdate?: number;
  add_at?: number;
  duration?: number;
  pgc_label?: string;
  bangumi?: { ep_id?: number } | null;
}

interface ToviewData {
  list?: ToviewRow[] | null;
}

interface ToviewResponse {
  code: number;
  message?: string;
  data?: ToviewData;
}

/** 从链接 query 取搜索关键词（桌面 search_url：watch_later→key） */
function keyFromUrl(raw: string): string {
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    return (new URL(withScheme).searchParams.get("key") ?? "").trim();
  } catch {
    return "";
  }
}

function assertToviewOk(body: ToviewResponse): void {
  if (body.code !== 0) {
    if (isLoginApiError(body.code, body.message)) {
      throw new BiliError("LOGIN_REQUIRED", body.message ?? "需要登录后查看稍后再看", { apiCode: body.code });
    }
    throw new BiliError("API_ERROR", body.message ?? "稍后再看接口返回错误", { apiCode: body.code });
  }
}

export class WatchLaterParser implements Parser {
  async parse(ctx: ParseContext, url: string, options?: ParseOptions): Promise<ParseResult> {
    const { type } = classifyUrl(url);
    if (type !== "watch_later") throw new BiliError("INVALID_URL", "不是稍后再看链接");
    requireLogin(ctx, "稍后再看");

    const key = keyFromUrl(url);
    const pn =
      options?.pn !== undefined && Number.isFinite(options.pn)
        ? Math.max(1, Math.floor(options.pn))
        : 1;

    const { imgKey, subKey } = await ensureWbiKeys(ctx);
    const signed = wbiSign(
      { pn, ps: PAGE_SIZE, viewed: 0, key, asc: false, need_split: true, web_location: "***.***" },
      imgKey,
      subKey,
    );
    const body = await ctx.http.getJSON<ToviewResponse>(`${API_BASE}/x/v2/history/toview/web`, { params: signed });
    assertToviewOk(body);
    const rows = body.data?.list ?? [];

    const items: MediaItem[] = [];
    const videoRows = rows.filter((r) => r.bvid && !r.bangumi).map((r) => ({ bvid: r.bvid as string }));
    items.push(
      ...(await expandVideoRows(ctx, videoRows)).map((item) => ({
        ...item,
        containerType: "watch_later" as const,
        containerTitle: "稍后再看",
      })),
    );
    // bangumi 行：桌面按 BANGUMI 二次解析到整季；Web 收窄为"该集"单叶（pgc flavor 用 bvid+cid）
    for (const row of rows) {
      if (!row.bangumi || !row.bvid || !row.cid) continue;
      const epId = row.bangumi.ep_id;
      items.push({
        id: `bangumi:${row.bvid}:ep${epId ?? row.cid}`,
        type: "bangumi",
        ...(row.aid !== undefined ? { aid: row.aid } : {}),
        bvid: row.bvid,
        cid: row.cid,
        ...(epId !== undefined ? { epId } : {}),
        page: 1,
        title: row.title ?? "",
        groupTitle: row.title ?? "",
        duration: row.duration ?? 0,
        badge: row.pgc_label ?? "",
        cover: row.pic ?? "",
        pubtime: row.pubdate ?? 0,
        owner: { mid: 0, name: "", face: "" },
        desc: "",
        url: `https://www.bilibili.com/bangumi/play/ep${epId ?? row.cid}`,
      });
    }

    return { type: "watch_later", items, ...(key ? { title: `搜索“${key}”` } : {}) };
  }
}
