import type { MediaItem, ParseResult } from "../services/types.js";

/**
 * 解析结果的**多级树**（对齐原版 `util/parse/episode/*` 建出来的树）。
 *
 * 原版是树，最多 4 层可见（`01-原版功能清单` §2.1）：
 *   不可见包装根 → 解析对象 → 分组（合集/章节）→ 分P → 可下载叶子
 * 每一层容器行都在**「序号」列显示层名**（「合集」「章节」「分P」），叶子显示自己的序号。
 *
 * 我们的引擎是**平铺**的（一个 ParseResult = 一堆叶子 + 层级元数据），所以这里用
 * `collectionTitle` / `sectionTitle` / `containerTitle` 三个字段**把层级还原回来**：
 *
 *   collectionTitle → 「合集」层        （引擎在 ugc_season 展开时给）
 *   sectionTitle    → 「章节」层        （引擎在章节数 > 1 时给）
 *   containerTitle  → 「分P」层         （引擎在多P 稿件上给，对应原版 parent_title）
 *   bvid 分组       → 视频层            （收藏夹/空间等容器行展开后，一个稿件一行）
 */

export interface TreeNode {
  id: string;
  /** 容器行：序号列显示这个层名（合集/章节/分P）；叶子为 undefined，显示序号 */
  label?: string;
  kind: "group" | "leaf";
  title: string;
  groupKey?: string;
  children?: TreeNode[];
  item?: MediaItem;
  checked: boolean | "partial";
  collapsed?: boolean;
  /** 叶子的全序（建树时定下）：序号列显示它，按「序号」列排序也用它 */
  seq?: number;
}

/** 解析对象的分类名（序号列那一行显示的文字）。取自原版 `EPISODE_TYPE` 的简中译文。 */
export const CATEGORY_LABEL: Record<string, string> = {
  video: "投稿视频",
  bangumi: "番剧",
  cheese: "课程",
  lesson: "会员购课程",
  audio: "音乐",
  list: "合集",
  favlist: "收藏夹",
  space: "个人空间",
  watch_later: "稍后再看",
  history: "历史记录",
  popular: "每周必看",
};

interface GroupSpec {
  key: string;
  title: string;
  label?: string;
  items: MediaItem[];
}

function groupBy(items: MediaItem[], pick: (it: MediaItem) => string | undefined): GroupSpec[] {
  const map = new Map<string, GroupSpec>();
  for (const it of items) {
    const name = pick(it);
    const key = name ?? "";
    let g = map.get(key);
    if (!g) {
      g = { key, title: name ?? "", items: [] };
      map.set(key, g);
    }
    g.items.push(it);
  }
  return [...map.values()];
}

/** 叶子：不可再分的分P */
function leafOf(it: MediaItem): TreeNode {
  return { id: it.id, kind: "leaf", title: it.title || it.groupTitle, item: it, checked: false };
}

/** 排序键（对应原版列配置的 attr_key） */
export type SortKey = "number" | "title" | "badge" | "duration" | "dyn_time";

/**
 * 时间列的**取值字段**随解析类型变（原版 `model.py:_get_dyn_time_attr_key`）：
 * 历史记录看观看时间、收藏夹看收藏时间、其余看发布时间。
 */
export function dynTimeKey(results: ParseResult[]): "viewtime" | "favtime" | "pubtime" {
  const types = results.map((r) => r.type);
  if (types.includes("history")) return "viewtime";
  if (types.includes("favlist")) return "favtime";
  return "pubtime";
}

/** 时间列的**列名**（原版 `COLUMN_NAME.dyn_time` 的简中译文随类型切换） */
export function dynTimeLabel(results: ParseResult[]): string {
  switch (dynTimeKey(results)) {
    case "viewtime": return "上次观看时间";
    case "favtime": return "收藏时间";
    default: return "发布时间";
  }
}

/**
 * 点表头排序 —— 对齐原版 `model.py:226-258` 的 `sort()`：
 * **对每一层的 children 递归排序**（不是只排顶层），升/降序按列的取值。
 */
export function sortTree(nodes: TreeNode[], key: SortKey, desc: boolean, timeKey: "viewtime" | "favtime" | "pubtime" = "pubtime"): TreeNode[] {
  const valueOf = (n: TreeNode): string | number => {
    switch (key) {
      case "title": return n.title;
      // 序号用建树时记下的叶子全序，排它等于"恢复原顺序"
      case "number": return n.seq ?? 0;
      case "badge": return n.item?.badge ?? "";
      case "duration": return n.item?.duration ?? 0;
      case "dyn_time": return (n.item?.[timeKey] as number | undefined) ?? 0;
      default: return 0;
    }
  };
  const walk = (ns: TreeNode[]): TreeNode[] =>
    [...ns]
      .sort((a, b) => {
        const va = valueOf(a);
        const vb = valueOf(b);
        const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "zh-Hans-CN");
        return desc ? -cmp : cmp;
      })
      .map((n) => (n.children ? { ...n, children: walk(n.children) } : n));
  return walk(nodes);
}

/** 「分P」层：一个稿件多P 时建一层，单P 直接出叶子 */
function videoLevel(items: MediaItem[], prefix: string): TreeNode[] {
  const out: TreeNode[] = [];
  const byBvid = groupBy(items, (it) => it.bvid ?? `_${it.id}`);
  for (const g of byBvid) {
    if (g.items.length <= 1) {
      out.push(leafOf(g.items[0]!));
      continue;
    }
    out.push({
      id: `${prefix}:v:${g.key}`,
      // 「分P」这个层名只在**合集的语境**下出现（原版 ugc_season_parser 里给多P 稿件插的那层）。
      // 收藏夹/空间展开出来的视频行是「视频行」本身，不该被标成「分P」—— 它没有层名。
      ...(g.items[0]!.containerTitle ? { label: "分P" } : {}),
      kind: "group",
      title: g.items[0]!.containerTitle || g.items[0]!.groupTitle,
      groupKey: g.key,
      children: g.items.map(leafOf),
      checked: false,
    });
  }
  return out;
}

/** 章节层（原版：章节数 > 1 才有这一层） */
function sectionLevel(items: MediaItem[], prefix: string): TreeNode[] {
  if (!items.some((it) => it.sectionTitle)) return videoLevel(items, prefix);
  return groupBy(items, (it) => it.sectionTitle).map((sec) => ({
    id: `${prefix}:sec:${sec.key}`,
    label: "章节",
    kind: "group" as const,
    title: sec.title,
    groupKey: sec.key,
    children: videoLevel(sec.items, `${prefix}:sec:${sec.key}`),
    checked: false as const,
  }));
}

/**
 * 顶层那一行。
 *
 * ⚠️ 原版的顶行**就是解析器返回的那个节点本身**，不是"解析对象"外再包一层：
 *   - 属于合集时，顶行是**「合集」行**（`ugc_season_parser` 建的根节点，number="合集"）
 *   - 否则才是按类型命名的行（投稿视频/收藏夹/个人空间…），见 `single_parser` 等
 * 这一条是拿原版渲染图对出来的：原版首行是「合集 艾尔登法环白金攻略」，
 * 我第一版写成「投稿视频 → 合集 → …」，平白多了一层。
 */
function topLevel(r: ParseResult, prefix: string): { label: string; title: string; children: TreeNode[] } {
  const collectionTitle = r.items.find((it) => it.collectionTitle)?.collectionTitle;
  if (collectionTitle) {
    return {
      label: "合集",
      title: collectionTitle,
      children: sectionLevel(r.items, `${prefix}:col`),
    };
  }
  return {
    label: CATEGORY_LABEL[r.type] ?? r.type,
    title: r.title ?? "",
    children: sectionLevel(r.items, prefix),
  };
}

/**
 * 建树。顶层 = 解析器返回的那个节点（每个解析结果一行；批量解析就有多行）。
 */
export function buildTree(results: ParseResult[]): TreeNode[] {
  const nodes = results.map((r, i) => {
    const prefix = `result:${i}`;
    const top = topLevel(r, prefix);
    return {
      id: prefix,
      label: top.label,
      kind: "group" as const,
      title: top.title,
      groupKey: `${r.type}:${i}`,
      children: top.children,
      checked: false as const,
    };
  });
  // 给**每个节点**打前序序号（只用于"按序号排序时恢复原顺序"）：
  // 容器行也必须有号，否则它们会因为没有号而被排到最前。
  // ⚠️ 与「序号」列显示的数字**不是一回事** —— 列里显示的是叶子的连续序号（1..N），
  //    由渲染时的行计数器算（见 ParseTree 的 rowSeq，原版也是这么显示的）。
  let seq = 0;
  const assign = (ns: TreeNode[]): TreeNode[] =>
    ns.map((n) => ({ ...n, seq: (seq += 1), ...(n.children ? { children: assign(n.children) } : {}) }));
  return assign(nodes);
}

/**
 * 按「序号」列的数字勾选（原版 `tree_view.py:721-728` 的 batch_select：命中就勾上，不清除其它）。
 *
 * 这里的"序号"是**叶子的连续序号**（列里显示的那个），不是 `seq`（那是全树前序号，只给排序用）。
 */
export function setByLeafIndices(nodes: TreeNode[], want: Set<number>): TreeNode[] {
  let ordinal = 0;
  const walk = (ns: TreeNode[]): TreeNode[] =>
    ns.map((n) => {
      if (n.children) return { ...n, children: walk(n.children) };
      ordinal += 1;
      return want.has(ordinal) ? { ...n, checked: true as const } : n;
    });
  return walk(nodes);
}

/** 把解析后的初始勾选集合打到树上（命中叶子即勾；容器行的半选/全选由 recompute 汇总） */
export function applyInitialChecked(nodes: TreeNode[], ids: Set<string>): TreeNode[] {
  const walk = (ns: TreeNode[]): TreeNode[] =>
    ns.map((n) => {
      if (n.children) return { ...n, children: walk(n.children) };
      return ids.has(n.id) ? { ...n, checked: true as const } : n;
    });
  return walk(nodes);
}

/**
 * 关键词搜索：返回标题命中的节点 id（前序，**含分组节点** —— 原版
 * `util/parse/episode/tree.py:314 search_items` 就是"标题包含即命中"，不分层级）。
 * 命中项只用于高亮/跳转/批量勾选，**不隐藏**未命中的行（原版也不过滤）。
 */
export function searchNodes(nodes: TreeNode[], keyword: string): string[] {
  const q = keyword.trim().toLowerCase();
  if (!q) return [];
  const hits: string[] = [];
  const walk = (ns: TreeNode[]): void => {
    for (const n of ns) {
      if (n.title.toLowerCase().includes(q)) hits.push(n.id);
      if (n.children) walk(n.children);
    }
  };
  walk(nodes);
  return hits;
}
