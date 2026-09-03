import { BiliError } from "../errors.js";
import { wbiSign } from "../api/wbi.js";
import { ensureWbiKeys } from "../media/wbi-keys.js";
import { classifyUrl } from "../url.js";
import { API_BASE } from "./video.js";
import { expandVideoRows } from "./expand.js";
import type { ParseContext, ParseOptions, ParseResult, Parser } from "./types.js";

/**
 * UP 主页解析器（space.bilibili.com/{mid}，支持 ?keyword= 站内搜索）。
 * 语义对齐桌面 parser/space.py + episode/space.py：
 * - mid 只从 URL 路径提取，避免查询参数干扰；搜索关键词取 query 的 keyword（随链接传递）
 * - 投稿列表走 x/space/wbi/arc/search（WBI 签名，ps=40，anti-spider 字段照抄），UP 名走 card?mid
 * - 桌面把每行做成"需二次解析"的容器行（无 cid）；Web 无树模型，这里并发调 view
 *   把每个视频的全部分P 平铺成叶子条目（见计划文档 Task 2.5/2.6 决策）
 */

/** 每页投稿条数（桌面 space.py ps=40） */
const PAGE_SIZE = 40;

/** 模块级 UP 名缓存（桌面 Data.uname_map 的进程内等价实现） */
const unameCache = new Map<number, string>();

/** 清空 UP 名缓存（测试用） */
export function resetSpaceCache(): void {
  unameCache.clear();
}

/** arc/search vlist 行（只声明本模块用到的字段；实测该接口行内无 cid） */
interface SpaceVideoRow {
  aid: number;
  bvid: string;
  pic?: string;
  title: string;
  created: number;
  length?: string;
  is_charging_arc?: boolean;
  is_lesson_video?: boolean;
  is_union_video?: boolean;
}

interface ArcSearchData {
  list?: { vlist?: SpaceVideoRow[] };
  page?: { count?: number; pn?: number; ps?: number };
}

interface ArcSearchResponse {
  code: number;
  message?: string;
  data?: ArcSearchData;
}

interface CardResponse {
  code: number;
  message?: string;
  data?: { card?: { name?: string } };
}

/** 从链接 query 提取搜索关键词（桌面 search_url.extract_keyword：space→keyword） */
function keywordFromUrl(raw: string): string {
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    return (new URL(withScheme).searchParams.get("keyword") ?? "").trim();
  } catch {
    return "";
  }
}

/** 解析 UP 主页链接：返回 mid 与站内搜索关键词（非 space 链接报 INVALID_URL） */
function parseSpaceTarget(raw: string): { mid: number; keyword: string } {
  const { type, token } = classifyUrl(raw);
  if (type !== "space") {
    throw new BiliError("INVALID_URL", "不是 UP 主页链接");
  }
  const mid = Number(token);
  if (!Number.isInteger(mid) || mid <= 0) {
    throw new BiliError("INVALID_URL", `无法识别 UP 主 id：${token}`);
  }
  return { mid, keyword: keywordFromUrl(raw) };
}

/** 桌面 episode/space.get_episode_badge：充电专属 > 课程 > 合作 */
function spaceRowBadge(row: SpaceVideoRow): string {
  if (row.is_charging_arc) return "充电专属";
  if (row.is_lesson_video) return "课程";
  if (row.is_union_video) return "合作";
  return "";
}



export class SpaceParser implements Parser {
  async parse(ctx: ParseContext, url: string, options?: ParseOptions): Promise<ParseResult> {
    const { mid, keyword } = parseSpaceTarget(url);
    const pn =
      options?.pn !== undefined && Number.isFinite(options.pn)
        ? Math.max(1, Math.floor(options.pn))
        : 1;

    const data = await this.#fetchVlist(ctx, mid, pn, keyword);
    const vlist = data.list?.vlist ?? [];
    const uname = await this.#fetchUname(ctx, mid);

    const items = (
      await expandVideoRows(ctx, vlist.map((row) => ({ bvid: row.bvid, badge: spaceRowBadge(row) })))
    ).map((item) => ({ ...item, containerType: "space" as const }));

    const title = keyword ? `${uname} - 搜索“${keyword}”` : uname;
    const total = data.page?.count ?? 0;
    return {
      type: "space",
      title,
      items,
      ...(total > 0 ? { pagination: { total, page: pn, pageSize: PAGE_SIZE, totalPages: Math.ceil(total / PAGE_SIZE) } } : {}),
    } as ParseResult;
  }

  /** 投稿列表：x/space/wbi/arc/search（WBI 签名，参数与桌面 space.py 完全一致） */
  async #fetchVlist(
    ctx: ParseContext,
    mid: number,
    pn: number,
    keyword: string,
  ): Promise<ArcSearchData> {
    const { imgKey, subKey } = await ensureWbiKeys(ctx);
    const signed = wbiSign(
      {
        pn,
        ps: PAGE_SIZE,
        tid: 0,
        special_type: "",
        order: "pubdate",
        mid,
        index: 0,
        keyword,
        order_avoided: "true",
        platform: "web",
        web_location: "***.****",
        dm_img_list: "[]",
        dm_img_str: "V2ViR0wgMS4wIChPcGVuR0wgRVMgMi4wIENocm9taXVtKQ",
        dm_cover_img_str:
          "QU5HTEUgKE5WSURJQSwgTlZJRElBIEdlRm9yY2UgUlRYIDQwNjAgTGFwdG9wIEdQVSAoMHgwMDAwMjhFMCkgRGlyZWN0M0QxMSB2c181XzAgcHNfNV8wLCBEM0QxMSlHb29nbGUgSW5jLiAoTlZJRElBKQ",
        dm_img_inter: '{"ds":[],"wh":[3688,4546,12],"of":[119,238,119]}',
      },
      imgKey,
      subKey,
    );

    const body = await ctx.http.getJSON<ArcSearchResponse>(
      `${API_BASE}/x/space/wbi/arc/search`,
      { params: signed },
    );
    if (body.code !== 0) {
      throw new BiliError("API_ERROR", body.message ?? "UP 主页投稿接口返回错误", {
        apiCode: body.code,
      });
    }
    if (!body.data) {
      throw new BiliError("API_ERROR", "UP 主页投稿接口缺少 data");
    }
    return body.data;
  }

  /** UP 名称：x/web-interface/card?mid=，进程内按 mid 缓存（桌面 Data.uname_map） */
  async #fetchUname(ctx: ParseContext, mid: number): Promise<string> {
    const cached = unameCache.get(mid);
    if (cached !== undefined) return cached;

    const body = await ctx.http.getJSON<CardResponse>(`${API_BASE}/x/web-interface/card`, {
      params: { mid },
    });
    if (body.code !== 0) {
      throw new BiliError("API_ERROR", body.message ?? "获取 UP 主信息失败", {
        apiCode: body.code,
      });
    }
    const name = body.data?.card?.name ?? "";
    unameCache.set(mid, name);
    return name;
  }
}
