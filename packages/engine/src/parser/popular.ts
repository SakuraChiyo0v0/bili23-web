import { BiliError } from "../errors.js";
import { wbiSign } from "../api/wbi.js";
import { ensureWbiKeys } from "../media/wbi-keys.js";
import { classifyUrl } from "../url.js";
import type { MediaItem } from "../types.js";
import { API_BASE } from "./video.js";
import type { ParseContext, ParseOptions, ParseResult, Parser } from "./types.js";

/**
 * 每周必看解析器（www.bilibili.com/v/popular/weekly?num=N）。
 * 语义对齐桌面 parser/popular.py + episode/popular.py：
 * - 期数取 query 的 num（缺失按桌面抛"无效的链接"）
 * - 列表走 x/web-interface/popular/series/one（WBI 签名），条目自带 aid/bvid/cid，
 *   直接映射为投稿视频叶子（无需二次解析，桌面 VIDEO_BIT|WEEKLY_BIT）
 */

interface PopularListItem {
  aid: number;
  bvid: string;
  cid: number;
  pic?: string;
  title: string;
  duration?: number;
  pubdate?: number;
  owner?: { mid: number; name: string; face: string };
}

interface PopularData {
  config?: { label?: string };
  list?: PopularListItem[];
}

interface PopularResponse {
  code: number;
  message?: string;
  data?: PopularData;
}

/** 从链接取周榜期数（桌面 get_weekly_number：num=([0-9]+)） */
function weeklyNumberFromUrl(raw: string): number {
  const m = /num=(\d+)/.exec(raw);
  if (m?.[1]) return Number(m[1]);
  const { type } = classifyUrl(raw);
  if (type !== "popular") {
    throw new BiliError("INVALID_URL", "不是每周必看链接");
  }
  throw new BiliError("INVALID_URL", "无法从链接识别周榜期数（缺少 num 参数）");
}

export class PopularParser implements Parser {
  async parse(ctx: ParseContext, url: string, _options?: ParseOptions): Promise<ParseResult> {
    const number = weeklyNumberFromUrl(url);

    const { imgKey, subKey } = await ensureWbiKeys(ctx);
    const signed = wbiSign({ number, web_location: "***.***" }, imgKey, subKey);
    const body = await ctx.http.getJSON<PopularResponse>(
      `${API_BASE}/x/web-interface/popular/series/one`,
      { params: signed },
    );
    if (body.code !== 0) {
      throw new BiliError("API_ERROR", body.message ?? "每周必看接口返回错误", { apiCode: body.code });
    }
    const data = body.data;
    if (!data) {
      throw new BiliError("API_ERROR", "每周必看接口缺少 data");
    }

    const label = data.config?.label ?? "每周必看";
    const items: MediaItem[] = (data.list ?? []).map((row) => ({
      id: `video:${row.bvid}:p1`,
      type: "video",
      aid: row.aid,
      bvid: row.bvid,
      cid: row.cid,
      page: 1,
      title: row.title,
      groupTitle: row.title,
      duration: row.duration ?? 0,
      badge: "",
      cover: row.pic ?? "",
      pubtime: row.pubdate ?? 0,
      owner: row.owner ?? { mid: 0, name: "", face: "" },
      desc: "",
      url: `https://www.bilibili.com/video/${row.bvid}`,
    }));

    return { type: "popular", title: label, items };
  }
}