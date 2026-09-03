import { BiliError } from "../errors.js";
import { classifyUrl } from "../url.js";
import type { MediaItem } from "../types.js";
import { API_BASE } from "./video.js";
import { expandVideoRows } from "./expand.js";
import type { ParseContext, ParseOptions, ParseResult, Parser } from "./types.js";

/**
 * 合集/系列列表解析器（space.bilibili.com/{mid}/lists/{id}?type=season|series，以及 sid=）。
 * 语义对齐桌面 parser/list.py + episode/list.py：
 * - type=season 走 x/polymer/web-space/seasons_archives_list（page_size=30，按 season_id 区分）
 * - type=series 或 sid= 走 x/series/archives（ps=30，按 series_id 区分），额外调 x/series/series 取 meta
 * - 行结构 archives[]（aid/bvid/pic/duration/pubdate/title），URL 均为 /video/{bvid}；
 *   桌面每行 NEED_PARSE 需按 bvid 二次解析，Web 沿用展开语义并发 view 平铺分P。
 */

/** 每页条数（桌面 list.py ps=30） */
const PAGE_SIZE = 30;

/** season 合集接口（x/polymer/web-space/seasons_archives_list）的 data */
interface SeasonData {
  archives?: Array<{
    aid: number;
    bvid: string;
    pic?: string;
    duration?: number;
    pubdate?: number;
    title?: string;
  }>;
  meta?: { title?: string; name?: string };
  page?: { total?: number };
}

/** series 系列接口（x/series/archives）的 data（meta 需另调 x/series/series） */
interface SeriesData {
  archives?: Array<{
    aid: number;
    bvid: string;
    pic?: string;
    duration?: number;
    pubdate?: number;
    title?: string;
  }>;
  page?: { total?: number };
}

interface SeasonResponse { code: number; message?: string; data?: SeasonData; }
interface SeriesResponse { code: number; message?: string; data?: SeriesData; }
interface SeriesMetaResponse { code: number; message?: string; data?: { meta?: { title?: string; name?: string } }; }

/** 从链接提取合集/系列 id（桌面 get_season_id/get_series_id/get_sid 语义） */
function extractTarget(raw: string): { mid: number; mode: "season" | "series"; id: number } {
  const { type } = classifyUrl(raw);
  if (type !== "list") {
    throw new BiliError("INVALID_URL", "不是合集/系列链接");
  }

  const midMatch = /space\.bilibili\.com\/(\d+)\/lists\/(\d+)/.exec(raw);
  const sidMatch = /sid=(\d+)/.exec(raw);
  const bareListMatch = /bilibili\.com\/list\/(\d+)/.exec(raw);

  let mid = 0;
  let id: number;
  let mode: "season" | "series";

  if (midMatch) {
    mid = Number(midMatch[1]);
    id = Number(midMatch[2]);
    if (/\?type=season/.test(raw)) mode = "season";
    else if (/\?type=series/.test(raw)) mode = "series";
    else mode = "series";
  } else if (sidMatch) {
    id = Number(sidMatch[1]);
    mode = "series";
  } else if (bareListMatch) {
    id = Number(bareListMatch[1]);
    mode = "series";
  } else {
    throw new BiliError("INVALID_URL", `无法从链接识别合集/系列 id：${raw}`);
  }

  if (!Number.isInteger(id) || id <= 0) {
    throw new BiliError("INVALID_URL", `合集/系列 id 非法：${id}`);
  }
  return { mid, mode, id };
}

/** 取合集/系列主标题（桌面 get_node_title：meta.title 优先，否则 meta.name） */
function collectionTitleFrom(meta: { title?: string; name?: string } | undefined): string {
  if (meta?.title) return meta.title;
  if (meta?.name) return meta.name;
  return "";
}

interface ListArchiveRow {
  aid: number;
  bvid: string;
  pic?: string;
  duration?: number;
  pubdate?: number;
  title?: string;
}

export class ListParser implements Parser {
  async parse(ctx: ParseContext, url: string, options?: ParseOptions): Promise<ParseResult> {
    const { mid, mode, id } = extractTarget(url);
    const pn =
      options?.pn !== undefined && Number.isFinite(options.pn)
        ? Math.max(1, Math.floor(options.pn))
        : 1;

    let archives: ListArchiveRow[] = [];
    let pageTotal = 0;
    let title = "";

    if (mode === "season") {
      const body = await ctx.http.getJSON<SeasonResponse>(
        `${API_BASE}/x/polymer/web-space/seasons_archives_list`,
        {
          params: {
            mid,
            season_id: id,
            sort_reverse: "false",
            page_size: PAGE_SIZE,
            page_num: pn,
            web_location: "***.****",
          },
        },
      );
      if (body.code !== 0) {
        throw new BiliError("API_ERROR", body.message ?? "合集列表接口返回错误", { apiCode: body.code });
      }
      const data = body.data;
      if (!data) throw new BiliError("API_ERROR", "合集列表接口缺少 data");
      archives = data.archives ?? [];
      pageTotal = data.page?.total ?? 0;
      title = collectionTitleFrom(data.meta);
    } else {
      const body = await ctx.http.getJSON<SeriesResponse>(`${API_BASE}/x/series/archives`, {
        params: {
          mid,
          current_mid: 0,
          series_id: id,
          only_normal: "true",
          sort: "desc",
          ps: PAGE_SIZE,
          pn,
          web_location: "***.****",
        },
      });
      if (body.code !== 0) {
        throw new BiliError("API_ERROR", body.message ?? "系列列表接口返回错误", { apiCode: body.code });
      }
      const data = body.data;
      if (!data) throw new BiliError("API_ERROR", "系列列表接口缺少 data");
      archives = data.archives ?? [];
      pageTotal = data.page?.total ?? 0;

      // 系列接口本身不含 meta，需额外调 x/series/series 取标题
      const metaBody = await ctx.http.getJSON<SeriesMetaResponse>(`${API_BASE}/x/series/series`, {
        params: { series_id: id, web_location: "***.****" },
      });
      if (metaBody.code === 0) {
        title = collectionTitleFrom(metaBody.data?.meta);
      }
    }

    const rows = archives.filter((a) => a.bvid && a.aid).map((a) => ({ bvid: a.bvid }));
    const items: MediaItem[] = (await expandVideoRows(ctx, rows)).map((item) => ({
      ...item,
      containerType: "list" as const,
      ...(title ? { collectionTitle: title } : {}),
    }));

    return {
      type: "list",
      title,
      items,
      ...(pageTotal > 0 ? { pagination: { total: pageTotal, page: pn, pageSize: PAGE_SIZE, totalPages: Math.ceil(pageTotal / PAGE_SIZE) } } : {}),
    } as ParseResult;
  }
}
