import { BiliError } from "../errors.js";
import { classifyUrl } from "../url.js";
import type { MediaItem } from "../types.js";
import type { ParseContext, ParseOptions, ParseResult, Parser } from "./types.js";

/** 会员购商城课程接口基址（与课堂 pugv 不同：无 season_id/ep_id/aid/cid，靠四元组定位） */
export const LESSON_API_BASE = "https://mall.bilibili.com/mall-search-items";
/** 课程详情（目录）接口 */
export const LESSON_DETAIL_URL = `${LESSON_API_BASE}/items/course/h5/detail`;

interface LessonSection {
  sectionId?: number;
  sectionName?: string;
  /** 小节可属不同 lesson（以接口返回为准，缺省回落课程级 lessonId） */
  lessonId?: number;
  sectionIndex?: number;
  /** 毫秒 */
  videoTime?: number;
  hasWatchRight?: boolean;
  couldPreview?: boolean;
}

interface LessonChapter {
  chapterName?: string;
  sectionList?: LessonSection[];
}

interface LessonData {
  lessonName?: string;
  itemsName?: string;
  courseId?: number;
  lessonId?: number;
  itemId?: number;
  chapterList?: LessonChapter[];
}

interface LessonResponse {
  success?: boolean;
  code: number;
  message?: string;
  data?: LessonData | null;
}

/** 登录 cookie 名：B 站主登录态，桌面版同样以 SESSDATA 判断 is_login */
const LOGIN_COOKIE = "SESSDATA";

function assertResponseOk(body: { code: number; message?: string }): void {
  if (body.code !== 0) {
    // mall 未登录与未购买都只回「系统异常」一类文案，无法从业务码区分，
    // 登录态在进入接口前已前置检查（与桌面 lesson.py check_login 一致）
    throw new BiliError("API_ERROR", body.message ?? "商城课程接口返回错误", { apiCode: body.code });
  }
}

function idFromQuery(raw: string, name: string): number | undefined {
  const query = new URL(raw).searchParams;
  const value = query.get(name)?.trim() ?? "";
  if (!/^\d+$/.test(value)) return undefined;
  return Number(value);
}

/**
 * 商城课程解析器。语义对齐桌面 parser/lesson.py + episode/lesson.py：
 * 链接只带 courseId/lessonId/itemId，小节（sectionId）来自课程详情接口的 chapterList；
 * 未登录直接 LOGIN_REQUIRED（匿名调用 mall 接口只回「系统异常」，无法可靠映射）。
 * 小节过滤：无 sectionId 或未更新（无 videoTime）的课程节不进列表。
 */
export class LessonParser implements Parser {
  async parse(ctx: ParseContext, raw: string, _options?: ParseOptions): Promise<ParseResult> {
    const { type } = classifyUrl(raw);
    if (type !== "lesson") {
      throw new BiliError("INVALID_URL", "不是商城课程链接");
    }

    const courseId = idFromQuery(raw, "courseId");
    const lessonId = idFromQuery(raw, "lessonId");
    const itemId = idFromQuery(raw, "itemId");
    if (courseId === undefined || lessonId === undefined || itemId === undefined) {
      throw new BiliError("INVALID_URL", "无法从链接中识别课程信息（需 courseId/lessonId/itemId）");
    }

    if (!ctx.http.jar.has(LOGIN_COOKIE)) {
      throw new BiliError("LOGIN_REQUIRED", "商城课程需登录后才能解析");
    }

    const body = await ctx.http.postJSON<LessonResponse>(LESSON_DETAIL_URL, {
      json: { courseId, lessonId, itemId },
      headers: { Referer: "https://mall.bilibili.com/", Origin: "https://mall.bilibili.com" },
    });
    assertResponseOk(body);
    const data = body.data;
    if (!data || typeof data !== "object") {
      throw new BiliError("API_ERROR", "接口未返回课程数据，请确认该课程是否已购买");
    }

    // 接口可能不完整回显课程 id，缺失时回落链接里的值
    const courseIdFinal = data.courseId ?? courseId;
    const lessonIdFinal = data.lessonId ?? lessonId;
    const itemIdFinal = data.itemId ?? itemId;
    const courseTitle = data.lessonName || data.itemsName || "";

    const items: MediaItem[] = [];
    for (const chapter of data.chapterList ?? []) {
      const sections = chapter.sectionList ?? [];
      if (sections.length === 0) continue;
      for (const section of sections) {
        const sectionId = section.sectionId;
        if (sectionId === undefined || !section.videoTime) continue;
        items.push({
          id: `lesson:course${courseIdFinal}:item${itemIdFinal}:sec${sectionId}`,
          type: "lesson",
          courseId: courseIdFinal,
          lessonId: section.lessonId ?? lessonIdFinal,
          itemId: itemIdFinal,
          sectionId,
          page: items.length + 1,
          title: section.sectionName ?? "",
          groupTitle: courseTitle,
          duration: Math.floor(section.videoTime / 1000),
          badge: section.hasWatchRight ? "" : section.couldPreview ? "试看" : "付费",
          cover: "",
          pubtime: 0,
          owner: { mid: 0, name: "", face: "" },
          desc: chapter.chapterName ?? "",
          url: `https://mall.bilibili.com/lesson/play?courseId=${courseIdFinal}&lessonId=${lessonIdFinal}&itemId=${itemIdFinal}`,
        });
      }
    }
    return { type: "lesson", title: courseTitle, items };
  }
}
