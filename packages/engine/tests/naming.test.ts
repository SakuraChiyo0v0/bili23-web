import { describe, expect, it } from "vitest";
import { ConventionType, DEFAULT_NAMING_RULES } from "../src/naming/variables.js";
import { formatFileName, normalizePath, sanitizeComponent, strftime, validateRule } from "../src/naming/formatter.js";
import { buildNamingVariables, resolveConventionType } from "../src/naming/context.js";
import { NumberingAllocator, NumberingType, allocNumber } from "../src/naming/numbering.js";
import type { MediaItem } from "../src/types.js";

const QUALITY = { videoQuality: "1080P", audioQuality: "192K", videoCodec: "HEVC" };

function makeItem(partial: Partial<MediaItem>): MediaItem {
  return {
    id: "video:BV1xx:p1",
    type: "video",
    page: 1,
    title: "分P标题",
    groupTitle: "主标题",
    duration: 10,
    badge: "",
    cover: "",
    pubtime: 0,
    owner: { mid: 123, name: "UP主", face: "" },
    desc: "",
    url: "",
    ...partial,
  };
}

function ruleOf(type: number): string {
  const entry = DEFAULT_NAMING_RULES.find((r) => r.type === type);
  if (!entry) throw new Error("no rule");
  return entry.rule;
}

describe("resolveConventionType", () => {
  it("video 多分P → PART，单分P → NORMAL", () => {
    expect(resolveConventionType(makeItem({ partCount: 3 }))).toBe(ConventionType.PART);
    expect(resolveConventionType(makeItem({ partCount: 1 }))).toBe(ConventionType.NORMAL);
  });
  it("互动视频 → INTERACTIVE_VIDEO", () => {
    expect(resolveConventionType(makeItem({ interactive: true, partCount: 3 }))).toBe(ConventionType.INTERACTIVE_VIDEO);
  });
  it("容器类型优先", () => {
    expect(resolveConventionType(makeItem({ containerType: "favlist", partCount: 1 }))).toBe(ConventionType.FAVORITE);
    expect(resolveConventionType(makeItem({ containerType: "space", partCount: 2 }))).toBe(ConventionType.SPACE);
    expect(resolveConventionType(makeItem({ containerType: "history" }))).toBe(ConventionType.HISTORY);
    expect(resolveConventionType(makeItem({ containerType: "watch_later" }))).toBe(ConventionType.WATCH_LATER);
    expect(resolveConventionType(makeItem({ containerType: "popular" }))).toBe(ConventionType.WEEKLY);
  });
  it("类型分类", () => {
    expect(resolveConventionType(makeItem({ type: "bangumi" }))).toBe(ConventionType.BANGUMI);
    expect(resolveConventionType(makeItem({ type: "cheese" }))).toBe(ConventionType.CHEESE);
    expect(resolveConventionType(makeItem({ type: "lesson" }))).toBe(ConventionType.LESSON);
    expect(resolveConventionType(makeItem({ type: "audio" }))).toBe(ConventionType.AUDIO);
  });
});

describe("formatFileName", () => {
  it("PART 默认规则 → 主标题/P{page}-分P标题", () => {
    const item = makeItem({ page: 2, partCount: 2 });
    const vars = buildNamingVariables(item, QUALITY, 1, 1772841600);
    expect(formatFileName(ruleOf(ConventionType.PART), vars)).toBe("主标题/P2-分P标题");
  });

  it("BANGUMI 默认规则 → 季标题/剧集标题", () => {
    const item = makeItem({
      type: "bangumi",
      seasonTitle: "轻音少女 第二季",
      title: "第18话 主角！",
      groupTitle: "轻音少女 第二季",
    });
    const vars = buildNamingVariables(item, QUALITY, 1, 0);
    expect(formatFileName(ruleOf(ConventionType.BANGUMI), vars)).toBe("轻音少女 第二季/第18话 主角！");
  });

  it("FAVORITE 默认规则含收藏夹主人与收藏夹名", () => {
    const item = makeItem({
      containerType: "favlist",
      favoritesId: 8888,
      favoritesName: "默认收藏夹",
      favoritesOwner: { mid: 456, name: "收藏者" },
      title: "视频标题",
    });
    const vars = buildNamingVariables(item, QUALITY, 1, 0);
    expect(formatFileName(ruleOf(ConventionType.FAVORITE), vars)).toBe("456_收藏者/默认收藏夹/视频标题");
  });

  it("AUDIO 默认规则 → 歌单/歌手 - 歌曲", () => {
    const item = makeItem({
      type: "audio",
      groupTitle: "我的歌单",
      owner: { mid: 0, name: "歌手", face: "" },
      title: "歌曲",
    });
    const vars = buildNamingVariables(item, QUALITY, 1, 0);
    expect(formatFileName(ruleOf(ConventionType.AUDIO), vars)).toBe("我的歌单/歌手 - 歌曲");
  });

  it("datetime 变量按 strftime 格式化", () => {
    // 用本地时区构造期望值，避免测试随 TZ 漂移
    const ts = 1772841600;
    const d = new Date(ts * 1000);
    const p = (n: number): string => String(n).padStart(2, "0");
    const expected = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
    const vars = buildNamingVariables(makeItem({ pubtime: ts }), QUALITY, 1, 0);
    expect(formatFileName("{pub_time:%Y-%m-%d_%H-%M-%S}", vars)).toBe(expected);
  });

  it("数字补零 {number:03d}", () => {
    const vars = buildNamingVariables(makeItem({}), QUALITY, 7, 0);
    expect(formatFileName("{number:03d}-{leaf_title}", vars)).toBe("007-分P标题");
  });

  it("非法字符清洗：标题中的 / 与 : 变 _", () => {
    const item = makeItem({ title: "A/B:C" });
    const vars = buildNamingVariables(item, QUALITY, 1, 0);
    expect(formatFileName("{leaf_title}", vars)).toBe("A_B_C");
  });

  it("空/非法结果回落 _", () => {
    const vars = buildNamingVariables(makeItem({ title: "..", groupTitle: "" }), QUALITY, "", 0);
    expect(formatFileName(ruleOf(ConventionType.NORMAL), vars)).toBe("_");
  });

  it("未知变量抛错；validateRule 报告未知变量", () => {
    const vars = buildNamingVariables(makeItem({}), QUALITY, 1, 0);
    expect(() => formatFileName("{nope}", vars)).toThrow(/未知变量/);
    const known = new Set(Object.keys(vars));
    expect(validateRule("{leaf_title}/{nope}", known)).toHaveLength(1);
    expect(validateRule("{leaf_title}", known)).toHaveLength(0);
  });
});

describe("sanitizeComponent / normalizePath / strftime", () => {
  it("sanitizeComponent 替换 <>/\\|?* 与控制字符", () => {
    expect(sanitizeComponent('a<b>c:d"e/f\\g|h?i*j')).toBe("a_b_c_d_e_f_g_h_i_j");
  });
  it("normalizePath 处理多级与空段", () => {
    expect(normalizePath("/a//b/")).toBe("a/b");
    expect(normalizePath("\\a\\b")).toBe("a/b");
    expect(normalizePath("")).toBe("_");
    expect(normalizePath("   ")).toBe("_");
    // 上游 strip(" .") 会剥掉 ".."，故与 Path.resolve 不同\n    expect(normalizePath("a/b/../c")).toBe("a/b/c");
  });
  it("strftime 基础记号", () => {
    const d = new Date(2026, 2, 7, 12, 0, 0); // 2026-03-07 12:00:00
    expect(strftime("%Y-%m-%d_%H-%M-%S", d)).toBe("2026-03-07_12-00-00");
    expect(strftime("%y%%%m", d)).toBe("26%03");
  });
});

describe("numbering", () => {
  it("CONTINUOUS 从 1 递增", () => {
    expect(allocNumber(NumberingType.CONTINUOUS, { current: 1 }).number).toBe(1);
    expect(allocNumber(NumberingType.CONTINUOUS, { current: 2 }).number).toBe(2);
  });
  it("FROM_SPECIFIED 从起始号递增", () => {
    const alloc = new NumberingAllocator(NumberingType.FROM_SPECIFIED, 5);
    expect(alloc.alloc()).toBe(5);
    expect(alloc.alloc()).toBe(6);
  });
  it("USE_PARSE_LIST 使用解析序号且不推进", () => {
    const alloc = new NumberingAllocator(NumberingType.USE_PARSE_LIST, 1);
    expect(alloc.alloc(4)).toBe(4);
    expect(alloc.alloc(9)).toBe(9);
  });
  it("USE_PARSE_LIST 无序号返回空串", () => {
    expect(allocNumber(NumberingType.USE_PARSE_LIST, { current: 3 }).number).toBe("");
  });
  it("CONTINUOUS allocator 连续推进", () => {
    const alloc = new NumberingAllocator(NumberingType.CONTINUOUS, 1);
    expect(alloc.alloc()).toBe(1);
    expect(alloc.alloc()).toBe(2);
  });
});

