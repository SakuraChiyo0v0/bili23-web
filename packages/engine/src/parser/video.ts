import { BiliError } from "../errors.js";
import { classifyUrl } from "../url.js";
import type { MediaItem } from "../types.js";
import { fetchInteractiveItems } from "./interactive.js";
import type { ParseContext, ParseOptions, ParseResult, Parser } from "./types.js";

/** B 站 Web API 基址 */
export const API_BASE = "https://api.bilibili.com";

/** view 接口响应（仅声明本模块用到的字段） */
interface UgcEpisode {
  aid?: number;
  bvid?: string;
  cid?: number;
  title?: string;
  pages?: Array<{ cid: number; page: number; part: string; duration: number }>;
  arc?: { pic?: string; pubdate?: number; duration?: number };
}

interface UgcSection {
  id?: number;
  title?: string;
  episodes?: UgcEpisode[];
}

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
    /** 合集：稿件属于某个 ugc_season 时，桌面会把**整个合集**展开（见 buildSeasonItems） */
    ugc_season?: { id?: number; title?: string; sections?: UgcSection[] };
  };
}

/** view 展开结果：一个稿件 → 其全部分P 的可下载叶子 */
export interface ViewResult {
  /** 稿件主标题 */
  title: string;
  items: MediaItem[];
  /** 内容被重定向（如跳转到番剧）：调用方应改用该地址重新解析 */
  redirectUrl?: string;
  /** 本次请求的那个稿件自己的 bvid（合集展开时用来定位"链接指向的是哪一集"） */
  ownBvid?: string;
  /** 命中互动视频但按调用方要求没有展开分支节点（见 `ParseOptions.expandInteractiveNodes`） */
  interactiveDetected?: boolean;
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
 * 合集（ugc_season）展开 —— 对齐桌面 `episode/video.py:107-214` 的 `ugc_season_parser`。
 *
 * 层级（原版是树，我们平铺成带元数据的叶子，层级信息落在字段上供前端建树）：
 *   合集 →（**多章节**才有的）章节 →（该稿件**多P**才有的）分P → 叶子
 *
 * 关键行为：
 * - 只要稿件属于合集，就展开**整个合集**（原版实测：单个稿件 133 项 ≈ 整个合集的分P 总数）
 * - `section_title` 仅在**章节数 > 1** 时才给（原版 `related_titles` 就是这么写的：
 *   `section_title if section_count > 1 else ""`）
 * - `parent_title`（= 我们的 `containerTitle`）仅**多P** 时给
 * - 叶子属性 `VIDEO_BIT | COLLECTION_BIT` → 我们映射为 `containerType: "list"`
 *   （`resolveConventionType` 据此选 `ConventionType.COLLECTION`，与原版一致）
 */
export function buildSeasonItems(data: NonNullable<ViewResponse["data"]>, onlyBvid?: string): MediaItem[] {
  const season = data.ugc_season;
  if (!season) return [];
  const collectionTitle = season.title ?? "";
  const sections = season.sections ?? [];
  const multiSection = sections.length > 1;
  const owner = data.owner ?? { mid: 0, name: "", face: "" };
  const items: MediaItem[] = [];
  let number = 0;

  const push = (ep: UgcEpisode, opts: { cid: number; page: number; partCount: number; title: string; duration: number; url: string; parentTitle?: string; sectionTitle: string }) => {
    number += 1;
    if (ep.bvid === undefined) return;
    items.push({
      id: `video:${ep.bvid}:p${opts.page}`,
      type: "video",
      aid: ep.aid ?? 0,
      bvid: ep.bvid,
      cid: opts.cid,
      page: opts.page,
      partCount: opts.partCount,
      title: opts.title,
      groupTitle: collectionTitle,
      duration: opts.duration,
      badge: "",
      cover: ep.arc?.pic ?? data.pic,
      pubtime: ep.arc?.pubdate ?? data.pubdate,
      owner,
      desc: data.desc,
      url: opts.url,
      containerType: "list",
      ...(collectionTitle ? { collectionTitle } : {}),
      ...(opts.sectionTitle ? { sectionTitle: opts.sectionTitle } : {}),
      ...(opts.parentTitle ? { containerTitle: opts.parentTitle } : {}),
    });
  };

  for (const section of sections) {
    const sectionTitle = multiSection ? (section.title ?? "") : "";
    for (const ep of section.episodes ?? []) {
      if (ep.bvid === undefined) continue;
      // 二次解析（容器行指名要这一个稿件）时只保留它 —— 对应原版 ugc_season_parser 里的
      // `if self.target_episode_info and episode["bvid"] != target: continue`。
      // 少了这一步，收藏夹里一个属于合集的视频会把整个合集都拉进来。
      if (onlyBvid !== undefined && ep.bvid !== onlyBvid) continue;
      const pages = ep.pages ?? [];
      if (pages.length > 1) {
        // 多P 稿件：原版多插一层「分P」节点，parent_title = 稿件标题
        for (const pg of pages) {
          push(ep, {
            cid: pg.cid,
            page: pg.page,
            partCount: pages.length,
            title: pg.part,
            duration: pg.duration,
            url: `https://www.bilibili.com/video/${ep.bvid}?p=${pg.page}`,
            parentTitle: ep.title ?? "",
            sectionTitle,
          });
        }
      } else {
        // 单P：直接一个叶子
        const cid = pages[0]?.cid ?? ep.cid;
        if (cid === undefined) continue;
        push(ep, {
          cid,
          page: 1,
          partCount: 1,
          title: ep.title ?? "",
          duration: pages[0]?.duration ?? ep.arc?.duration ?? 0,
          url: `https://www.bilibili.com/video/${ep.bvid}`,
          sectionTitle,
        });
      }
    }
  }
  return items;
}

/**
 * 按 bvid/aid 拉取稿件详情（x/web-interface/view）并按分P 展开成叶子条目。
 * VideoParser 与 space/favlist 等"容器行需二次解析"的解析器共用（对应桌面 ReparseWorker 的 view 展开）。
 */
export async function fetchViewItems(
  ctx: ParseContext,
  ident: { bvid?: string; aid?: number },
  /** 二次解析语义：只保留这个 bvid（容器行指名的那一个），不展开整个合集 */
  opts: { onlyBvid?: string; expandInteractiveNodes?: boolean; ignoreSeason?: boolean } = {},
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

  const ownBvid = body.data.bvid;

  // 互动视频（rights.is_stein_gate === 1）：不按分P 展开，改走 BFS 分支节点。
  // `expandInteractiveNodes === false` 时只回报"这是互动视频"，让调用方先问用户
  // （桌面 `parser/video.py:265-268` → InteractiveVideoDialog → 二次解析）。
  if (body.data.rights?.is_stein_gate === 1) {
    if (opts.expandInteractiveNodes === false) {
      return { title: body.data.title, items: buildItems(body.data), ownBvid, interactiveDetected: true };
    }
    const items = await fetchInteractiveItems(ctx, body.data);
    return { title: body.data.title, items, ownBvid };
  }

  // 合集优先于分P（原版 `episode/video.py:17-25` 的 match 顺序：ugc_season 先判）。
  // `ignoreSeason` = 原版 MultiPartListsDialog 里那句 `del info_data["data"]["ugc_season"]`：
  // 只要这个稿件自己的分P，不要把整个合集一起展开。
  if (!opts.ignoreSeason && body.data.ugc_season?.sections?.length) {
    return {
      title: body.data.ugc_season.title ?? body.data.title,
      items: buildSeasonItems(body.data, opts.onlyBvid),
      ownBvid,
    };
  }

  return { title: body.data.title, items: buildItems(body.data), ownBvid };
}

/**
 * 链接指向的分P cid（对齐桌面 `episode/video.py:get_cid`）：
 * URL 带 `?p=N` 时取第 N 页的 cid，否则取链接那个稿件自己的第一页。
 *
 * 合集展开后 items 里有很多稿件，**必须先按 ownBvid 收窄**，否则 `?p=2` 会命中别的稿件的第 2 个分P。
 */
function targetCidFromUrl(raw: string, items: MediaItem[], ownBvid?: string): number | undefined {
  const pool = ownBvid ? items.filter((it) => it.bvid === ownBvid) : items;
  const candidates = pool.length > 0 ? pool : items;
  const p = Number(/[?&]p=(\d+)/.exec(raw)?.[1] ?? NaN);
  if (Number.isInteger(p) && p > 0) {
    const hit = candidates.find((it) => it.page === p);
    if (hit?.cid !== undefined) return hit.cid;
  }
  return candidates[0]?.cid;
}

export class VideoParser implements Parser {
  async parse(ctx: ParseContext, url: string, _options?: ParseOptions): Promise<ParseResult> {
    const { bvid, aid } = bvidOrAidFromUrl(url);
    const ident: { bvid?: string; aid?: number } = {};
    if (bvid !== undefined) ident.bvid = bvid;
    if (aid !== undefined) ident.aid = aid;

    const view = await fetchViewItems(ctx, ident, {
      ...(_options?.expandInteractiveNodes !== undefined
        ? { expandInteractiveNodes: _options.expandInteractiveNodes }
        : {}),
      ...(_options?.ignoreSeason !== undefined ? { ignoreSeason: _options.ignoreSeason } : {}),
    });
    if (view.redirectUrl) {
      return { type: "video", items: [], redirectUrl: view.redirectUrl };
    }
    const targetCid = targetCidFromUrl(url, view.items, view.ownBvid);
    return {
      type: "video",
      title: view.title,
      items: view.items,
      ...(targetCid !== undefined ? { target: { key: "cid" as const, value: targetCid } } : {}),
      ...(view.interactiveDetected ? { interactiveDetected: true } : {}),
    };
  }
}
