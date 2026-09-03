import { BiliError } from "../errors.js";
import { classifyUrl } from "../url.js";
import type { MediaItem } from "../types.js";
import type { ParseContext, ParseOptions, ParseResult, Parser } from "./types.js";

/** PUGV（课堂课程）view 接口响应 */
interface CourseEpisode {
  id?: number;
  aid?: number;
  cid?: number;
  cover?: string;
  duration?: number;
  release_date?: number | string;
  title?: string;
  status?: number;
  label?: string;
}

interface CourseSection {
  title?: string;
  episodes?: CourseEpisode[];
}

interface CourseResult {
  season_id?: number;
  title?: string;
  cover?: string;
  subtitle?: string;
  current_ep_id?: number;
  up_info?: { mid?: number; uname?: string; avatar?: string };
  sections?: CourseSection[];
}

interface CourseResponse {
  code: number;
  message?: string;
  data?: CourseResult;
}

function assertOk(body: { code: number; message?: string }): void {
  if (body.code !== 0) {
    throw new BiliError("API_ERROR", body.message ?? "获取课程信息失败", { apiCode: body.code });
  }
}

/** badge 语义对齐桌面 get_episode_badge：label 优先，否则 status 1/2/3 映射 */
function episodeBadge(ep: CourseEpisode): string {
  if (ep.label !== undefined && ep.label !== "") return ep.label;
  return ({ 1: "全集试看", 2: "付费", 3: "部分试看" } as Record<number, string>)[ep.status ?? -1] ?? "";
}

/**
 * 课堂课程解析器。语义对齐桌面 parser/cheese.py + episode/cheese.py：
 * ep/ss → pugv/view/web/season/v2；data.sections 平铺（空章节跳过）；
 * ep_id 取 episode.id；duration 已是秒；url 为 cheese/play/{id}。
 */
export class CheeseParser implements Parser {
  async parse(ctx: ParseContext, raw: string, _options?: ParseOptions): Promise<ParseResult> {
    const { type, token } = classifyUrl(raw);
    if (type !== "cheese") {
      throw new BiliError("INVALID_URL", "不是课堂课程链接");
    }

    let params: { ep_id?: string; season_id?: string };
    if (/^ep/i.test(token)) {
      params = { ep_id: token.replace(/^ep/i, "") };
    } else if (/^ss/i.test(token)) {
      params = { season_id: token.replace(/^ss/i, "") };
    } else {
      throw new BiliError("INVALID_URL", `无法识别的课程链接：${token}`);
    }

    const body = await ctx.http.getJSON<CourseResponse>("https://api.bilibili.com/pugv/view/web/season/v2", {
      params,
    });
    assertOk(body);
    const data = body.data;
    if (!data) {
      throw new BiliError("API_ERROR", "课程接口缺少 data");
    }

    const owner = {
      mid: data.up_info?.mid ?? 0,
      name: data.up_info?.uname ?? "",
      face: data.up_info?.avatar ?? "",
    };

    const items: MediaItem[] = [];
    let page = 0;
    for (const section of data.sections ?? []) {
      const episodes = section.episodes ?? [];
      if (episodes.length === 0) continue;
      for (const ep of episodes) {
        if (ep.id === undefined || ep.cid === undefined) continue;
        page += 1;
        items.push({
          id: `cheese:ep${ep.id}`,
          type: "cheese",
          aid: ep.aid ?? 0,
          cid: ep.cid,
          epId: ep.id,
          page,
          title: ep.title ?? "",
          groupTitle: data.title ?? "",
          duration: ep.duration ?? 0,
          badge: episodeBadge(ep),
          cover: ep.cover ?? data.cover ?? "",
          pubtime: Number(ep.release_date ?? 0),
          owner,
          desc: "",
          url: `https://www.bilibili.com/cheese/play/${ep.id}`,
        });
      }
    }

    return { type: "cheese", title: data.title ?? "", items };
  }
}
