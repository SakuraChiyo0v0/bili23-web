import { describe, expect, it } from "vitest";
import { computeAutoChecked, DEFAULT_AUTO_SELECT_CONDITIONS } from "../src/client/lib/autoSelect.js";
import type { AutoSelectConditions, MediaItem, ParseResult } from "../src/client/services/types.js";

function mkItem(id: string, extra: Partial<MediaItem> = {}): MediaItem {
  return {
    id,
    type: "video",
    page: 1,
    title: id,
    groupTitle: "组",
    duration: 0,
    badge: "",
    cover: "",
    pubtime: 0,
    owner: { mid: 0, name: "", face: "" },
    desc: "",
    url: "",
    ...extra,
  };
}

function cond(partial: Partial<AutoSelectConditions>): AutoSelectConditions {
  return { ...DEFAULT_AUTO_SELECT_CONDITIONS, ...partial };
}

/** 分P 视频：两个分P，链接指向 P2 */
function videoResult(): ParseResult {
  return {
    type: "video",
    items: [mkItem("video:BV1:p1", { cid: 1001, page: 1 }), mkItem("video:BV1:p2", { cid: 1002, page: 2 })],
    target: { key: "cid", value: 1002 },
  };
}

/** 番剧：正片两集 + 一个"特别篇"分节 */
function bangumiResult(): ParseResult {
  return {
    type: "bangumi",
    items: [
      mkItem("bangumi:ep1", { type: "bangumi", epId: 1, sectionTitle: "正片" }),
      mkItem("bangumi:ep2", { type: "bangumi", epId: 2, sectionTitle: "正片" }),
      mkItem("bangumi:ep9", { type: "bangumi", epId: 9, sectionTitle: "特别篇" }),
    ],
    target: { key: "ep_id", value: 9 },
  };
}

describe("computeAutoChecked · 三种模式", () => {
  it("手动：一条都不勾", () => {
    expect(computeAutoChecked([videoResult()], "manual", cond({ userUploads: 1 })).size).toBe(0);
  });

  it("全选：勾满全部叶子", () => {
    const ids = computeAutoChecked([videoResult(), bangumiResult()], "all");
    expect([...ids].sort()).toEqual(["bangumi:ep1", "bangumi:ep2", "bangumi:ep9", "video:BV1:p1", "video:BV1:p2"]);
  });
});

describe("computeAutoChecked · 条件式（原版默认配置：三项全 0）", () => {
  it("投稿视频：只勾链接指向的那个分P", () => {
    expect([...computeAutoChecked([videoResult()], "conditional", cond({}))]).toEqual(["video:BV1:p2"]);
  });

  it("投稿视频没有 target 时一条不勾", () => {
    const r: ParseResult = { type: "video", items: [mkItem("v1", { cid: 1 })] };
    expect(computeAutoChecked([r], "conditional", cond({})).size).toBe(0);
  });

  it("番剧：只勾链接指向的那一集（哪怕它在特别篇里）", () => {
    expect([...computeAutoChecked([bangumiResult()], "conditional", cond({}))]).toEqual(["bangumi:ep9"]);
  });

  it("其它类型（收藏夹等）：一条不勾", () => {
    const r: ParseResult = { type: "favlist", items: [mkItem("f1"), mkItem("f2")] };
    expect(computeAutoChecked([r], "conditional", cond({})).size).toBe(0);
  });
});

describe("computeAutoChecked · 条件式的三类条件", () => {
  it("userUploads=1：投稿视频的分P 全勾", () => {
    const ids = computeAutoChecked([videoResult()], "conditional", cond({ userUploads: 1 }));
    expect([...ids].sort()).toEqual(["video:BV1:p1", "video:BV1:p2"]);
  });

  it("bangumi=1：番剧勾正片（第一个分节），特别篇不勾", () => {
    const ids = computeAutoChecked([bangumiResult()], "conditional", cond({ bangumi: 1 }));
    // 正片两集 + 链接指向的特别篇那一集（原版也是两者都勾：定位与条件分派互不影响）
    expect([...ids].sort()).toEqual(["bangumi:ep1", "bangumi:ep2", "bangumi:ep9"]);
  });

  it("bangumi=1：课程类（cheese/lesson）整份全勾", () => {
    const cheese: ParseResult = { type: "cheese", items: [mkItem("c1", { type: "cheese" }), mkItem("c2", { type: "cheese" })] };
    const lesson: ParseResult = { type: "lesson", items: [mkItem("l1", { type: "lesson" })] };
    const ids = computeAutoChecked([cheese, lesson], "conditional", cond({ bangumi: 1 }));
    expect([...ids].sort()).toEqual(["c1", "c2", "l1"]);
  });

  it("other=1：列表型（空间/收藏夹/历史…）整份全勾", () => {
    const fav: ParseResult = { type: "favlist", items: [mkItem("f1"), mkItem("f2")] };
    const space: ParseResult = { type: "space", items: [mkItem("s1")] };
    const ids = computeAutoChecked([fav, space], "conditional", cond({ other: 1 }));
    expect([...ids].sort()).toEqual(["f1", "f2", "s1"]);
  });

  it("三项条件互不串台：只开 other 不会把投稿视频整份勾上", () => {
    // 仍然只勾链接指向的那个分P（target 与条件分派互不影响）
    expect([...computeAutoChecked([videoResult()], "conditional", cond({ other: 1 }))]).toEqual(["video:BV1:p2"]);
  });
});

describe("computeAutoChecked · 链接指向项的三种比对键", () => {
  it("section_id（会员购课程）", () => {
    const r: ParseResult = {
      type: "lesson",
      items: [mkItem("l1", { type: "lesson", sectionId: 11 }), mkItem("l2", { type: "lesson", sectionId: 12 })],
      target: { key: "section_id", value: 12 },
    };
    expect([...computeAutoChecked([r], "conditional", cond({}))]).toEqual(["l2"]);
  });

  it("target 指向的项不存在于 items 时，静默不勾（原版同样定位不到）", () => {
    const r: ParseResult = {
      type: "bangumi",
      items: [mkItem("bangumi:ep1", { type: "bangumi", epId: 1, sectionTitle: "正片" })],
      target: { key: "ep_id", value: 999 },
    };
    expect(computeAutoChecked([r], "conditional", cond({})).size).toBe(0);
  });
});
