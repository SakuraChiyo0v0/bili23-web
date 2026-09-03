import { BiliError } from "../errors.js";
import { classifyUrl } from "../url.js";
import type { MediaItem } from "../types.js";
import { API_BASE } from "./video.js";
import { expandVideoRows } from "./expand.js";
import type { ParseContext, ParseOptions, ParseResult, Parser } from "./types.js";

/**
 * 收藏夹解析器（space/{uid}/favlist?fid= 与 www.bilibili.com/list/ml{id}）。
 * 语义对齐桌面 parser/favlist.py + episode/favlist.py：
 * - media_id 取 fid= 或 ml 开头的数字；支持 ?keyword= 站内搜索
 * - 列表走 x/v3/fav/resource/list（明文，ps=40，order=mtime）
 * - 桌面把每行做成"需二次解析"的容器行（视频行无 cid）；Web 并发调 view 平铺分P。
 *   番剧/影视类（ogv）行桌面按 BANGUMI 二次解析，Web 暂无等价的整季展开语义，P2 跳过并在计划记录。
 */

/** 每页收藏条数（桌面 favlist.py ps=40） */
const PAGE_SIZE = 40;

/** favlist resource/list 的媒体行（只声明用到的字段） */
interface FavMediaRow {
  id: number;
  bvid?: string;
  title?: string;
  cover?: string;
  pubtime?: number;
  fav_time?: number;
  page?: number;
  duration?: number;
  ogv?: { type_name?: string } | null;
}

interface FavlistData {
  info?: {
    id?: number;
    title?: string;
    media_count?: number;
    upper?: { mid?: number; name?: string };
  };
  medias?: FavMediaRow[] | null;
}

interface FavlistResponse {
  code: number;
  message?: string;
  data?: FavlistData;
}

/** 从链接取收藏夹 id：fid= 优先，其次 ml{id}（桌面 get_media_id） */
function mediaIdFromUrl(raw: string): number {
  const fid = /fid=(\d+)/.exec(raw);
  if (fid?.[1]) return Number(fid[1]);
  const ml = /ml(\d+)/.exec(raw);
  if (ml?.[1]) return Number(ml[1]);
  const { type, token } = classifyUrl(raw);
  if (type !== "favlist") {
    throw new BiliError("INVALID_URL", "不是收藏夹链接");
  }
  throw new BiliError("INVALID_URL", `无法从链接识别收藏夹 id：${token}`);
}

/** 从链接 query 提取搜索关键词（桌面 search_url.extract_keyword：favlist→keyword） */
function keywordFromUrl(raw: string): string {
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    return (new URL(withScheme).searchParams.get("keyword") ?? "").trim();
  } catch {
    return "";
  }
}

export class FavlistParser implements Parser {
  async parse(ctx: ParseContext, url: string, options?: ParseOptions): Promise<ParseResult> {
    const mediaId = mediaIdFromUrl(url);
    const keyword = keywordFromUrl(url);
    const pn =
      options?.pn !== undefined && Number.isFinite(options.pn)
        ? Math.max(1, Math.floor(options.pn))
        : 1;

    const body = await ctx.http.getJSON<FavlistResponse>(`${API_BASE}/x/v3/fav/resource/list`, {
      params: {
        media_id: mediaId,
        pn,
        ps: PAGE_SIZE,
        keyword,
        order: "mtime",
        type: 0,
        tid: 0,
        platform: "web",
        web_location: "***.****",
      },
    });
    if (body.code !== 0) {
      throw new BiliError("API_ERROR", body.message ?? "收藏夹接口返回错误", { apiCode: body.code });
    }
    const data = body.data;
    if (!data) {
      throw new BiliError("API_ERROR", "收藏夹接口缺少 data");
    }

    const folderTitle = data.info?.title ?? "";
    const medias = data.medias ?? [];
    const folderOwner = data.info?.upper;
    // 视频行平铺分P；番剧/影视（ogv）行与无 bvid 行跳过（见文件头注释）。
    // 收藏夹命名需要整夹上下文（收藏夹名/主人/收藏时间），在此一并落到每个叶子上
    const favtimeByAid = new Map<number, number>();
    const videoRows = medias
      .filter((m) => !m.ogv && m.bvid && m.id !== undefined)
      .map((m) => {
        if (m.fav_time) favtimeByAid.set(m.id, m.fav_time);
        return { bvid: m.bvid as string };
      });
    const items: MediaItem[] = (await expandVideoRows(ctx, videoRows)).map((item) => ({
      ...item,
      containerType: "favlist" as const,
      ...(data.info?.id !== undefined ? { favoritesId: data.info.id } : {}),
      ...(folderTitle ? { favoritesName: folderTitle } : {}),
      ...(folderOwner?.mid !== undefined && folderOwner.mid
        ? { favoritesOwner: { mid: folderOwner.mid, name: folderOwner.name ?? "" } }
        : {}),
      ...(item.aid !== undefined && favtimeByAid.has(item.aid)
        ? { favtime: favtimeByAid.get(item.aid)! }
        : {}),
    }));

    const title = keyword ? `${folderTitle} - 搜索“${keyword}”` : folderTitle;
    return { type: "favlist", title, items };
  }
}

