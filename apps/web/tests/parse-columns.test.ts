import { describe, expect, it } from "vitest";
import { applyInitialChecked, buildTree, dynTimeKey, dynTimeLabel, sortTree } from "../src/client/lib/parseTree.js";
import { DEFAULT_COLUMNS, normalizeColumns } from "../src/client/lib/parseListPrefs.js";
import type { MediaItem, ParseResult } from "../src/client/services/types.js";

function mkItem(id: string, extra: Partial<MediaItem> = {}): MediaItem {
  return {
    id, type: "video", page: 1, title: id, groupTitle: "组",
    duration: 0, badge: "", cover: "", pubtime: 0,
    owner: { mid: 0, name: "", face: "" }, desc: "", url: "",
    ...extra,
  };
}

describe("sortTree · 递归排序每一层（原版 model.py:226-258）", () => {
  /** 两个多P 稿件；标题用纯 ASCII，避免中英混排的 collation 让断言不稳定 */
  const tree = buildTree([{
    type: "favlist",
    title: "夹",
    items: [
      mkItem("g2p1", { bvid: "BV2", groupTitle: "G-B", duration: 300 }),
      mkItem("g2p2", { bvid: "BV2", page: 2, groupTitle: "G-B", duration: 100 }),
      mkItem("g1p1", { bvid: "BV1", groupTitle: "G-A", duration: 200 }),
      mkItem("g1p2", { bvid: "BV1", page: 2, groupTitle: "G-A", duration: 50 }),
    ],
  }]);

  /** 只取叶子，便于断言顺序 */
  function leafOrder(nodes: ReturnType<typeof sortTree>): string[] {
    const out: string[] = [];
    const walk = (ns: typeof nodes): void => {
      for (const n of ns) {
        if (n.children) walk(n.children);
        else out.push(n.id);
      }
    };
    walk(nodes);
    return out;
  }

  it("按标题升序：分组行也一起被排序（不是只排叶子）", () => {
    expect(leafOrder(sortTree(tree, "title", false))).toEqual(["g1p1", "g1p2", "g2p1", "g2p2"]);
  });

  it("降序就是反过来", () => {
    expect(leafOrder(sortTree(tree, "title", true))).toEqual(["g2p2", "g2p1", "g1p2", "g1p1"]);
  });

  it("按序号排 = 恢复建树时的原顺序（容器行也参与，不会被顶到最前）", () => {
    const sorted = sortTree(tree, "title", true);
    expect(leafOrder(sortTree(sorted, "number", false))).toEqual(["g2p1", "g2p2", "g1p1", "g1p2"]);
  });

  it("按时长排序（数值列）：组内按数值排；容器行没有时长，同值时保持原顺序", () => {
    // 容器行没有 duration（值取 0），两个组都并列 -> 稳定排序保持 [G-B, G-A]；
    // 组内按时长升序：G-B 内 100<300、G-A 内 50<200（原版对 TreeItem.duration 也是同样行为）
    expect(leafOrder(sortTree(tree, "duration", false))).toEqual(["g2p2", "g2p1", "g1p2", "g1p1"]);
  });

  it("排序不改变勾选等其它字段", () => {
    const base = buildTree([{ type: "video", title: "T", items: [mkItem("b", { bvid: "B" }), mkItem("a", { bvid: "A" })] }]);
    // 把两片叶子都勾上（复用真实的打勾函数，避免手搓出类型不一致的对象），排序后应当仍是勾上的
    const withCheck = applyInitialChecked(base, new Set(["a", "b"]));
    const sorted = sortTree(withCheck, "title", false);
    expect(sorted[0]!.children!.map((c) => c.id)).toEqual(["a", "b"]);
    expect(sorted[0]!.children!.every((c) => c.checked === true)).toBe(true);
  });
});

describe("时间列的字段与列名随解析类型变（原版 model.py:_get_dyn_time_attr_key）", () => {
  it("历史记录 → 上次观看时间（viewtime）", () => {
    expect(dynTimeKey([{ type: "history", items: [] }])).toBe("viewtime");
    expect(dynTimeLabel([{ type: "history", items: [] }])).toBe("上次观看时间");
  });
  it("收藏夹 → 收藏时间（favtime）", () => {
    expect(dynTimeKey([{ type: "favlist", items: [] }])).toBe("favtime");
    expect(dynTimeLabel([{ type: "favlist", items: [] }])).toBe("收藏时间");
  });
  it("其余 → 发布时间（pubtime）", () => {
    expect(dynTimeKey([{ type: "video", items: [] }])).toBe("pubtime");
    expect(dynTimeLabel([{ type: "video", items: [] }])).toBe("发布时间");
  });
});

describe("normalizeColumns · 列配置归一化", () => {
  it("空 / 脏数据 → 默认列（原版默认宽度 160/350/90/90/130）", () => {
    expect(normalizeColumns(undefined)).toEqual(DEFAULT_COLUMNS);
    expect(normalizeColumns([{ key: "不存在的列" }])).toEqual(DEFAULT_COLUMNS);
  });

  it("序号列锁定：被隐藏会强制打开，位置被挪动会拉回首位", () => {
    const out = normalizeColumns([
      { key: "title", width: 400, show: true },
      { key: "number", width: 120, show: false },
    ]);
    expect(out[0]!.key).toBe("number");
    expect(out[0]!.show).toBe(true);
  });

  it("保留用户改过的宽度与顺序，缺失的列按默认补在后面", () => {
    const out = normalizeColumns([{ key: "title", width: 500, show: true }]);
    expect(out[0]).toEqual({ key: "number", width: 160, show: true });
    expect(out[1]).toEqual({ key: "title", width: 500, show: true });
    expect(out.map((c) => c.key)).toEqual(["number", "title", "badge", "duration", "dyn_time"]);
  });

  it("过小的宽度会被忽略，落回默认值（拖拽时也不允许拖没）", () => {
    const out = normalizeColumns([{ key: "title", width: 3, show: true }]);
    expect(out.find((c) => c.key === "title")!.width).toBe(350);
  });
});
