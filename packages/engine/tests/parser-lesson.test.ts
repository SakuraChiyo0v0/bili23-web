import { beforeEach, describe, expect, it } from "vitest";
import { CookieJar } from "../src/api/cookies.js";
import { HttpClient } from "../src/api/http.js";
import { LessonParser } from "../src/parser/lesson.js";
import type { ParseContext } from "../src/parser/types.js";

/** mall 课程详情（登录态可见）。videoTime 单位毫秒（section/play/detail 才返回秒） */
const LESSON_DATA = {
  lessonName: "三体艺术设定课",
  itemsName: "【众筹】三体艺术设定课",
  courseId: 10001,
  lessonId: 20001,
  itemId: 30001,
  locationInfo: { sectionId: 11 },
  chapterList: [
    {
      chapterName: "第一章 世界观",
      sectionList: [
        { sectionId: 11, lessonId: 20001, sectionName: "红岸基地", sectionIndex: 1, videoTime: 3600000, videoTimeDesc: "60:00", hasWatchRight: true, couldPreview: true },
        { sectionId: 12, lessonId: 20002, sectionName: "古筝行动（试看）", sectionIndex: 2, videoTime: 7200000, videoTimeDesc: "02:00:00", hasWatchRight: false, couldPreview: true },
        { sectionId: 13, lessonId: 20001, sectionName: "面壁计划", sectionIndex: 3, videoTime: 5400000, videoTimeDesc: "01:30:00", hasWatchRight: false, couldPreview: false },
      ],
    },
    { chapterName: "空章节", sectionList: [] },
    {
      chapterName: "",
      sectionList: [{ sectionId: 21, sectionName: "未更新小节", sectionIndex: 1, videoTime: 0, hasWatchRight: false, couldPreview: false }],
    },
  ],
};

let calls: string[] = [];

function loggedCtx(data: unknown, code = 0): ParseContext {
  return {
    http: new HttpClient({
      cookieJar: CookieJar.parse("SESSDATA=stub-session; bili_jct=stub"),
      fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
        calls.push(`${String(input)} :: ${init?.body ?? ""}`);
        return new Response(JSON.stringify({ code, message: code === 0 ? "OK" : "系统异常！", data: code === 0 ? data : null }), { status: 200 });
      }) as typeof fetch,
    }),
  };
}

function anonCtx(): ParseContext {
  calls = [];
  return {
    http: new HttpClient({
      fetchImpl: (async (input: string | URL | Request) => {
        calls.push(String(input));
        return new Response(JSON.stringify({ code: 0, data: LESSON_DATA }), { status: 200 });
      }) as typeof fetch,
    }),
  };
}

const LESSON_URL = "https://mall.bilibili.com/lesson/play?courseId=10001&lessonId=20001&itemId=30001";

describe("LessonParser", () => {
  beforeEach(() => {
    calls = [];
  });

  it("已登录：POST h5/detail 并按章节平铺小节，badge/duration/lessonId 正确", async () => {
    const result = await new LessonParser().parse(loggedCtx(LESSON_DATA), LESSON_URL);
    expect(calls[0]).toContain("/mall-search-items/items/course/h5/detail");
    expect(calls[0]).toContain('"courseId":10001');
    expect(calls[0]).toContain('"lessonId":20001');
    expect(calls[0]).toContain('"itemId":30001');
    expect(result.type).toBe("lesson");
    expect(result.title).toBe("三体艺术设定课");
    // 3 个有效小节；空章节与未更新（无 videoTime）小节被剔除
    expect(result.items).toHaveLength(3);
    const s11 = result.items[0];
    expect(s11).toMatchObject({
      id: "lesson:course10001:item30001:sec11",
      type: "lesson",
      courseId: 10001,
      lessonId: 20001,
      itemId: 30001,
      sectionId: 11,
      page: 1,
      title: "红岸基地",
      groupTitle: "三体艺术设定课",
      duration: 3600, // 毫秒 → 秒（截断）
      badge: "", // hasWatchRight
      owner: { mid: 0, name: "", face: "" },
      url: "https://mall.bilibili.com/lesson/play?courseId=10001&lessonId=20001&itemId=30001",
    });
    expect(result.items[1]?.badge).toBe("试看"); // couldPreview
    expect(result.items[1]?.lessonId).toBe(20002); // 小节级 lessonId 优先
    expect(result.items[2]?.badge).toBe("付费");
  });

  it("未登录：直接抛 LOGIN_REQUIRED，且不发任何网络请求", async () => {
    await expect(new LessonParser().parse(anonCtx(), LESSON_URL)).rejects.toMatchObject({ code: "LOGIN_REQUIRED" });
    expect(calls).toHaveLength(0);
  });

  it("缺 courseId/lessonId/itemId 抛 INVALID_URL", async () => {
    await expect(new LessonParser().parse(loggedCtx(LESSON_DATA), "https://mall.bilibili.com/lesson/play?courseId=10001")).rejects.toMatchObject({
      code: "INVALID_URL",
    });
  });

  it("接口业务错误（如未购买回系统异常）映射 API_ERROR", async () => {
    await expect(new LessonParser().parse(loggedCtx(null, 11119999), LESSON_URL)).rejects.toMatchObject({
      code: "API_ERROR",
      apiCode: 11119999,
    });
  });

  it("code 为 0 但无 data（课程下架/无权限）映射 API_ERROR", async () => {
    await expect(new LessonParser().parse(loggedCtx(null), LESSON_URL)).rejects.toMatchObject({ code: "API_ERROR" });
  });

  it("非商城课程链接抛 INVALID_URL", async () => {
    await expect(new LessonParser().parse(loggedCtx(LESSON_DATA), "https://www.bilibili.com/cheese/play/ep45")).rejects.toMatchObject({
      code: "INVALID_URL",
    });
  });
});
