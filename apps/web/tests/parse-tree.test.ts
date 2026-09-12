import { describe, expect, it } from "vitest";
import { buildTree, setByLeafIndices, type TreeNode } from "../src/client/lib/parseTree.js";
import type { MediaItem, ParseResult } from "../src/client/services/types.js";

function mkItem(id: string, extra: Partial<MediaItem> = {}): MediaItem {
  return {
    id, type: "video", page: 1, title: id, groupTitle: "组",
    duration: 0, badge: "", cover: "", pubtime: 0,
    owner: { mid: 0, name: "", face: "" }, desc: "", url: "",
    ...extra,
  };
}

/** 把树压成 [层名/标题, 层级] 的列表，便于整体断言 */
function outline(nodes: TreeNode[], depth = 0): Array<[string, number]> {
  const out: Array<[string, number]> = [];
  for (const n of nodes) {
    out.push([n.label ? `${n.label}:${n.title}` : n.title, depth]);
    if (n.children) out.push(...outline(n.children, depth + 1));
  }
  return out;
}

describe("buildTree · 层级还原", () => {
  it("投稿视频（含合集）：顶行**就是「合集」行** → 章节 → 分P → 叶子（与原版渲染图一致）", () => {
    const r: ParseResult = {
      type: "video",
      title: "艾尔登法环白金攻略",
      items: [
        mkItem("a:p1", { bvid: "BV1A", collectionTitle: "白金攻略", sectionTitle: "正片", containerTitle: "第一章", groupTitle: "第一章" }),
        mkItem("a:p2", { bvid: "BV1A", page: 2, collectionTitle: "白金攻略", sectionTitle: "正片", containerTitle: "第一章", groupTitle: "第一章" }),
        mkItem("b:p1", { bvid: "BV1B", collectionTitle: "白金攻略", sectionTitle: "DLC", containerTitle: "DLC篇", groupTitle: "DLC篇" }),
      ],
    };
    const outline0 = outline(buildTree([r]));
    expect(outline0).toEqual([
      // ⚠️ 没有「投稿视频」这层包装 —— 原版首行就是「合集 艾尔登法环白金攻略」
      ["合集:白金攻略", 0],
      ["章节:正片", 1],
      ["分P:第一章", 2],
      ["a:p1", 3],
      ["a:p2", 3],
      ["章节:DLC", 1],
      // BV1B 只有 1 个分P —— 原版只在 `len(pages) > 1` 时才建「分P」层，所以它直接是叶子
      ["b:p1", 2],
    ]);
  });

  it("收藏夹：收藏夹 → 视频 → 分P；单P 视频直接出叶子（不建多余层）", () => {
    const r: ParseResult = {
      type: "favlist",
      title: "我的收藏",
      items: [
        mkItem("v1:p1", { bvid: "BV1", containerType: "favlist", groupTitle: "多P视频" }),
        mkItem("v1:p2", { bvid: "BV1", page: 2, containerType: "favlist", groupTitle: "多P视频" }),
        mkItem("v2:p1", { bvid: "BV2", containerType: "favlist", groupTitle: "单P视频" }),
      ],
    };
    expect(outline(buildTree([r]))).toEqual([
      ["收藏夹:我的收藏", 0],
      ["多P视频", 1],       // 多P -> 视频行（**没有层名**：层名「分P」只在合集语境下出现）
      ["v1:p1", 2],
      ["v1:p2", 2],
      ["v2:p1", 1],          // 单P -> 直接叶子
    ]);
  });

  it("番剧：番剧 → 章节 → 叶子（原版 3 层，章节恒有）", () => {
    const r: ParseResult = {
      type: "bangumi",
      title: "测试番剧",
      items: [
        mkItem("ep1", { type: "bangumi", epId: 1, sectionTitle: "正片", bvid: "BV1" }),
        mkItem("ep2", { type: "bangumi", epId: 2, sectionTitle: "正片", bvid: "BV2" }),
        mkItem("ep9", { type: "bangumi", epId: 9, sectionTitle: "特别篇", bvid: "BV9" }),
      ],
    };
    expect(outline(buildTree([r]))).toEqual([
      ["番剧:测试番剧", 0],
      ["章节:正片", 1],
      ["ep1", 2],
      ["ep2", 2],
      ["章节:特别篇", 1],
      ["ep9", 2],
    ]);
  });

  it("没有层级元数据时：解析对象 → 叶子（两层，不凭空造层）", () => {
    const r: ParseResult = { type: "popular", title: "每周必看", items: [mkItem("p1", { bvid: "BV1" }), mkItem("p2", { bvid: "BV2" })] };
    expect(outline(buildTree([r]))).toEqual([
      ["每周必看:每周必看", 0],
      ["p1", 1],
      ["p2", 1],
    ]);
  });

  it("批量解析多个结果：各自一行", () => {
    const a: ParseResult = { type: "video", title: "甲", items: [mkItem("a", { bvid: "BV1" })] };
    const b: ParseResult = { type: "favlist", title: "乙", items: [mkItem("b", { bvid: "BV2", containerType: "favlist" })] };
    expect(outline(buildTree([a, b]))).toEqual([
      ["投稿视频:甲", 0], ["a", 1],
      ["收藏夹:乙", 0], ["b", 1],
    ]);
  });
});

describe("setByLeafIndices · 按序号列的数字勾选（原版 batch_select）", () => {
  const tree = buildTree([{
    type: "video",
    title: "T",
    items: [
      mkItem("a1", { bvid: "BV1", containerTitle: "甲", groupTitle: "甲" }),
      mkItem("a2", { bvid: "BV1", page: 2, containerTitle: "甲", groupTitle: "甲" }),
      mkItem("b1", { bvid: "BV2", containerTitle: "乙", groupTitle: "乙" }),
      mkItem("b2", { bvid: "BV2", page: 2, containerTitle: "乙", groupTitle: "乙" }),
    ],
  }]);

  function checkedIds(nodes: TreeNode[]): string[] {
    const out: string[] = [];
    const walk = (ns: TreeNode[]): void => {
      for (const n of ns) {
        if (n.children) walk(n.children);
        else if (n.checked === true) out.push(n.id);
      }
    };
    walk(nodes);
    return out;
  }

  it("序号是叶子的全序（跨层连续），命中哪几个就勾哪几个", () => {
    expect(checkedIds(setByLeafIndices(tree, new Set([1, 4])))).toEqual(["a1", "b2"]);
  });

  it("是**追加**而不是替换：已经在勾的不会被清掉（原版只 set 不清）", () => {
    const preset = setByLeafIndices(tree, new Set([2]));
    expect(checkedIds(setByLeafIndices(preset, new Set([3])))).toEqual(["a2", "b1"]);
  });
});
