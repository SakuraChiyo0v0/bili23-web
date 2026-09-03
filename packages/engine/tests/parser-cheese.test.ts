import { describe, expect, it } from "vitest";
import { HttpClient } from "../src/api/http.js";
import { BiliError } from "../src/errors.js";
import { CheeseParser } from "../src/parser/cheese.js";
import type { ParseContext } from "../src/parser/types.js";

function makeCourseData() {
  return {
    season_id: 26568,
    title: "测试课堂课程",
    cover: "https://i0.hdslb.com/bfs/cheese/cover.jpg",
    subtitle: "课程一句话简介",
    up_info: { mid: 456, uname: "讲师", avatar: "https://i0.hdslb.com/face.jpg" },
    sections: [
      {
        title: "第一章",
        episodes: [
          { id: 45, aid: 7000001, cid: 900001, cover: "", duration: 3600, release_date: 1620000000, title: "课时1 介绍", status: 1, play_way_subtitle: "试看", subtitle: "免费内容" },
          { id: 46, aid: 7000001, cid: 900002, cover: "", duration: 4200, release_date: 1620000000, title: "课时2 正课", status: 2, label: "VIP", play_way_subtitle: "正式", subtitle: "付费内容" },
        ],
      },
      { title: "空章节", episodes: [] },
      {
        title: "第二章",
        episodes: [
          { id: 47, aid: 7000001, cid: 900003, cover: "", duration: 1800, release_date: 1620000001, title: "课时3 收尾", status: 3, play_way_subtitle: "试看", subtitle: "部分免费" },
        ],
      },
    ],
  };
}

let lastUrl = "";
let courseData: unknown = makeCourseData();

function makeCtx(): ParseContext {
  lastUrl = "";
  courseData = makeCourseData();
  const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    lastUrl = url;
    if (url.includes("/pugv/view/web/season/v2")) {
      return new Response(JSON.stringify({ code: 0, message: "", data: courseData }), { status: 200 });
    }
    return new Response(JSON.stringify({ code: -404, message: "not found" }), { status: 200 });
  };
  return { http: new HttpClient({ fetchImpl: fetchImpl as typeof fetch }) };
}

describe("CheeseParser", () => {
  it("ss 链接：请求 season/v2 并按分节平铺（跳过空章节），badge 按 status/label 映射", async () => {
    const result = await new CheeseParser().parse(makeCtx(), "https://www.bilibili.com/cheese/play/ss26568");
    expect(lastUrl).toContain("/pugv/view/web/season/v2?season_id=26568");
    expect(result.type).toBe("cheese");
    expect(result.title).toBe("测试课堂课程");
    expect(result.items).toHaveLength(3);
    const ep1 = result.items.find((i) => i.epId === 45);
    expect(ep1?.title).toBe("课时1 介绍");
    expect(ep1?.groupTitle).toBe("测试课堂课程");
    expect(ep1?.aid).toBe(7000001);
    expect(ep1?.cid).toBe(900001);
    expect(ep1?.badge).toBe("全集试看"); // status 1
    expect(ep1?.duration).toBe(3600); // pugv duration 已是秒，不做 /1000
    expect(ep1?.page).toBe(1);
    expect(ep1?.owner.name).toBe("讲师");
    expect(ep1?.url).toBe("https://www.bilibili.com/cheese/play/45");
    const ep2 = result.items.find((i) => i.epId === 46);
    expect(ep2?.badge).toBe("VIP"); // label 优先
    const ep3 = result.items.find((i) => i.epId === 47);
    expect(ep3?.badge).toBe("部分试看"); // status 3
    expect(ep3?.page).toBe(3);
  });

  it("ep 链接：以 ep_id 拉课程", async () => {
    const result = await new CheeseParser().parse(makeCtx(), "https://www.bilibili.com/cheese/play/ep45");
    expect(lastUrl).toContain("/pugv/view/web/season/v2?ep_id=45");
    expect(result.items.length).toBeGreaterThan(0);
  });

  it("接口业务错误映射 API_ERROR", async () => {
    const ctx = makeCtx();
    ctx.http = new HttpClient({
      fetchImpl: (async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/pugv/view/web/season/v2")) {
          return new Response(JSON.stringify({ code: -404, message: "课程不存在" }), { status: 200 });
        }
        return new Response(JSON.stringify({ code: -404, message: "not found" }), { status: 200 });
      }) as typeof fetch,
    });
    await expect(new CheeseParser().parse(ctx, "https://www.bilibili.com/cheese/play/ss9999")).rejects.toBeInstanceOf(BiliError);
  });

  it("非课程链接报 INVALID_URL", async () => {
    await expect(new CheeseParser().parse(makeCtx(), "https://www.bilibili.com/video/BV1xx411c7mD")).rejects.toMatchObject({ code: "INVALID_URL" });
  });
});
