import { BiliError } from "../errors.js";
import { classifyUrl } from "../url.js";
import type { MediaItem } from "../types.js";
import type { ParseContext, ParseOptions, ParseResult, Parser } from "./types.js";

/** PGC 公开接口基址（season / review / playurl 共用） */
export const PGC_API = "https://api.bilibili.com";

/** pgc/view/web/season 响应（仅声明本模块用到的字段） */
interface SeasonResult {
  season_id?: number;
  media_id?: number;
  season_title?: string;
  type?: number;
  cover?: string;
  evaluate?: string;
  current_ep_id?: number;
  up_info?: { mid?: number; uname?: string; avatar?: string };
  series?: { series_id?: number; series_title?: string };
  episodes?: SeasonEpisode[];
  section?: Array<{ title?: string; episodes?: SeasonEpisode[] }>;
}

interface SeasonEpisode {
  ep_id?: number;
  aid?: number;
  cid?: number;
  bvid?: string;
  badge?: string;
  cover?: string;
  duration?: number;
  arc?: { duration?: number };
  length?: string;
  pub_time?: number | string;
  title?: string;
  show_title?: string;
  link?: string;
}

interface SeasonResponse {
  code: number;
  message?: string;
  result?: SeasonResult;
}

function assertOk(body: { code: number; message?: string }): void {
  if (body.code !== 0) {
    throw new BiliError("API_ERROR", body.message ?? "获取番剧信息失败", { apiCode: body.code });
  }
}

/** "MM:SS" / "HH:MM:SS" → 秒（对齐桌面 Units.unformat_episode_duration） */
function unformatDuration(length: string): number {
  const parts = length.split(":").map((s) => Number(s));
  if (parts.some((n) => !Number.isFinite(n))) return 0;
  let total = 0;
  for (const part of parts) total = total * 60 + part;
  return total;
}

/** 单集时长（秒）：桌面 episode_item_data.duration = int(get_episode_duration / 1000) */
function episodeDurationSeconds(ep: SeasonEpisode): number {
  if (ep.duration !== undefined) return Math.floor(ep.duration / 1000);
  if (ep.arc?.duration !== undefined) return Math.floor(ep.arc.duration);
  if (ep.length) return unformatDuration(ep.length);
  return 0;
}

function bangumiTitle(ep: SeasonEpisode): string {
  return ep.show_title ?? ep.title ?? "";
}

/**
 * 番剧解析器。语义对齐桌面 parser/bangumi.py + episode/bangumi.py：
 * ep/ss 直接定位 season，md 先经 pgc/review/user 换 season_id；
 * 正片（result.episodes）+ 各分节（result.section）平铺为可下载条目；
 * 剔除"无 bvid/cid"的章节（如 UP主陪你看）。
 */
export class BangumiParser implements Parser {
  async parse(ctx: ParseContext, raw: string, _options?: ParseOptions): Promise<ParseResult> {
    const { type, token } = classifyUrl(raw);
    if (type !== "bangumi") {
      throw new BiliError("INVALID_URL", "不是番剧链接");
    }

    let params: { ep_id?: string; season_id?: string };
    if (/^ep/i.test(token)) {
      params = { ep_id: token.replace(/^ep/i, "") };
    } else if (/^ss/i.test(token)) {
      params = { season_id: token.replace(/^ss/i, "") };
    } else if (/^md/i.test(token)) {
      params = { season_id: await this.#seasonIdFromMedia(ctx, token.replace(/^md/i, "")) };
    } else {
      throw new BiliError("INVALID_URL", `无法识别的番剧链接：${token}`);
    }

    const body = await ctx.http.getJSON<SeasonResponse>(`${PGC_API}/pgc/view/web/season`, { params });
    assertOk(body);
    const result = body.result;
    if (!result) {
      throw new BiliError("API_ERROR", "番剧 season 接口缺少 result");
    }

    return this.#toResult(result);
  }

  async #seasonIdFromMedia(ctx: ParseContext, mediaId: string): Promise<string> {
    const body = await ctx.http.getJSON<{ code: number; message?: string; result?: { media?: { season_id?: number } } }>(
      `${PGC_API}/pgc/review/user`,
      { params: { media_id: mediaId } },
    );
    assertOk(body);
    const seasonId = body.result?.media?.season_id;
    if (!seasonId) {
      throw new BiliError("API_ERROR", "media 链接未找到关联 season");
    }
    return String(seasonId);
  }

  #toResult(result: SeasonResult): ParseResult {
    const seasonTitle = result.season_title ?? "";
    const owner = {
      mid: result.up_info?.mid ?? 0,
      name: result.up_info?.uname ?? "",
      face: result.up_info?.avatar ?? "",
    };

    // 正片 + 分节：桌面先把"正片"作为第一个分节，再追加 result.section
    const sections: Array<{ title: string; episodes: SeasonEpisode[] }> = [
      { title: "正片", episodes: result.episodes ?? [] },
      ...(result.section ?? []).map((s) => ({ title: s.title ?? "", episodes: s.episodes ?? [] })),
    ].filter((s) => s.episodes.every((ep) => ep.bvid && ep.cid));

    // 剧集序号：对正片按"非预告"计数（预告片与正片混排时不影响序号）
    const episodeNumberMap = new Map<number, number>();
    let number = 0;
    for (const ep of result.episodes ?? []) {
      if (ep.cid !== undefined && ep.badge !== "预告") {
        number += 1;
        episodeNumberMap.set(ep.cid, number);
      }
    }

    const items: MediaItem[] = [];
    let fallbackPage = 0;
    for (const section of sections) {
      for (const ep of section.episodes) {
        if (ep.cid === undefined || ep.bvid === undefined || ep.ep_id === undefined) continue;
        fallbackPage += 1;
        const epNumber = ep.cid !== undefined ? (episodeNumberMap.get(ep.cid) ?? 0) : 0;
        items.push({
          id: `bangumi:ep${ep.ep_id}`,
          type: "bangumi",
          aid: ep.aid ?? 0,
          bvid: ep.bvid,
          cid: ep.cid,
          epId: ep.ep_id,
          page: epNumber > 0 ? epNumber : fallbackPage,
          title: bangumiTitle(ep),
          groupTitle: seasonTitle,
          duration: episodeDurationSeconds(ep),
          badge: ep.badge ?? "",
          cover: ep.cover ?? result.cover ?? "",
          pubtime: Number(ep.pub_time ?? 0),
          owner,
          desc: "",
          url: ep.link ?? "",
        });
      }
    }

    return { type: "bangumi", title: seasonTitle, items };
  }
}
