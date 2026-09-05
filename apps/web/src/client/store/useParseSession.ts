import { create } from "zustand";
import type { MediaItem, ParseResult } from "../services/types";

export interface TreeNode {
  id: string;
  kind: "group" | "leaf";
  title: string;
  groupKey?: string;
  children?: TreeNode[];
  item?: MediaItem;
  checked: boolean | "partial";
  collapsed?: boolean;
}

export type ParseState = "idle" | "parsing" | "success" | "error";

interface ParseSession {
  state: ParseState;
  results: ParseResult[];
  tree: TreeNode[];
  input: string;
  parseType: string;
  autoPages: number;
  error?: string;
  setInput: (v: string) => void;
  setParseType: (t: string) => void;
  setAutoPages: (n: number) => void;
  start: () => void;
  success: (results: ParseResult[]) => void;
  fail: (error: string) => void;
  reset: () => void;
  toggle: (nodeId: string) => void;
  setAll: (v: boolean) => void;
  invertAll: () => void;
  setByIndices: (idx: Set<number>) => void;
  setNodeIdsChecked: (ids: Set<string>, v: boolean) => void;
  rangeToggle: (fromId: string, toId: string) => void;
  toggleCollapse: (nodeId: string) => void;
  expandAll: (open: boolean) => void;
  selectedLeaves: () => MediaItem[];
}

function buildTree(results: ParseResult[]): TreeNode[] {
  const rootCount: Record<string, { title: string; container?: string; items: MediaItem[] }> = {};
  for (const r of results) {
    for (const item of r.items) {
      const key = `${item.groupTitle}__${item.containerType ?? r.type}`;
      rootCount[key] ??= { title: item.groupTitle, container: item.containerType ?? r.type, items: [] };
      rootCount[key]!.items.push(item);
    }
  }
  const nodes: TreeNode[] = [];
  for (const key of Object.keys(rootCount)) {
    const g = rootCount[key]!;
    const grouped = g.items.map((it) => ({
      id: it.id, kind: "leaf" as const, title: it.title || it.groupTitle, item: it, checked: false,
    }));
    if (grouped.length === 1) {
      const it = g.items[0]!;
      nodes.push({ id: it.id, kind: "leaf", title: it.title, item: it, checked: false });
    } else {
      nodes.push({ id: `group:${key}`, kind: "group", title: g.title, groupKey: key, children: grouped, checked: false });
    }
  }
  return nodes;
}

function recompute(nodes: TreeNode[]): TreeNode[] {
  return nodes.map((n) => {
    if (!n.children) return { ...n, checked: n.checked === true };
    const children = recompute(n.children);
    const all = children.every((c) => c.checked === true);
    const none = children.every((c) => c.checked === false);
    return { ...n, children, checked: all ? true : none ? false : ("partial" as const) };
  });
}

function toggleNode(nodes: TreeNode[], id: string): TreeNode[] {
  return nodes.map((n) => {
    if (n.id === id) {
      const next = n.checked === true ? false : true;
      const apply = (child: TreeNode): TreeNode => ({ ...child, checked: next, children: child.children ? child.children.map(apply) : undefined });
      return { ...n, checked: next, children: n.children ? n.children.map(apply) : undefined };
    }
    if (n.children) return { ...n, children: toggleNode(n.children, id) };
    return n;
  });
}

function collect(items: MediaItem[], nodes: TreeNode[]): MediaItem[] {
  for (const n of nodes) {
    if (n.kind === "leaf" && n.item && n.checked === true) items.push(n.item);
    if (n.children) collect(items, n.children);
  }
  return items;
}

/** 收集所有叶子节点 id（树线性序，深度优先） */
function collectLeafIds(nodes: TreeNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.kind === "leaf") out.push(n.id);
    if (n.children) collectLeafIds(n.children, out);
  }
  return out;
}

/**
 * Shift 范围勾选：把 from..to 之间（含）的所有叶子设为与 from 叶子相同的勾选态。
 * 找不到 from/to（如组 id）时退化为普通 toggle。
 */
function toggleRangeIn(nodes: TreeNode[], fromId: string, toId: string): TreeNode[] {
  const leaves = collectLeafIds(nodes);
  const fi = leaves.indexOf(fromId);
  const ti = leaves.indexOf(toId);
  if (fi < 0 || ti < 0) return nodes;
  const [lo, hi] = fi <= ti ? [fi, ti] : [ti, fi];
  const base = nodes;
  const firstNode = findNode(base, leaves[lo]!);
  const want = firstNode ? firstNode.checked === true : true; // 半选按 true 处理
  const setLeaf = (ns: TreeNode[], id: string, v: boolean): TreeNode[] =>
    ns.map((n) => {
      if (n.kind === "leaf" && n.id === id) return { ...n, checked: v };
      if (n.children) return { ...n, children: setLeaf(n.children, id, v) };
      return n;
    });
  let out = base;
  const target = new Set(leaves.slice(lo, hi + 1));
  const apply = (ns: TreeNode[]): TreeNode[] =>
    ns.map((n) => {
      if (n.kind === "leaf" && target.has(n.id)) return { ...n, checked: want };
      if (n.children) return { ...n, children: apply(n.children) };
      return n;
    });
  out = apply(out);
  void setLeaf; void firstNode;
  return out;
}
function findNode(nodes: TreeNode[], id: string): TreeNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children) { const f = findNode(n.children, id); if (f) return f; }
  }
  return undefined;
}

function applyAll(nodes: TreeNode[], v: boolean): TreeNode[] {
  return nodes.map((n) => ({ ...n, checked: v, children: n.children ? applyAll(n.children, v) : undefined }));
}

function invertAll(nodes: TreeNode[]): TreeNode[] {
  return nodes.map((n) => ({ ...n, checked: n.checked === true ? false : true, children: n.children ? invertAll(n.children) : undefined }));
}

/** 按顶层结果条目序号（1..N）勾选：先全不选，再勾选指定序号对应的顶层节点（含其下所有分P叶子） */
function setByResultIndices(nodes: TreeNode[], want: Set<number>): TreeNode[] {
  const setChecked = (n: TreeNode, v: boolean): TreeNode => ({ ...n, checked: v, children: n.children ? n.children.map((c) => setChecked(c, v)) : undefined });
  return nodes.map((n, i) => {
    if (want.has(i + 1)) return setChecked(n, true);
    return setChecked(n, false);
  });
}

/** 仅把指定叶子/组 id 勾选为 v（其它不变）；group id 作用到整组 */
function setIdsChecked(nodes: TreeNode[], ids: Set<string>, v: boolean): TreeNode[] {
  const setChecked = (n: TreeNode, val: boolean): TreeNode => ({ ...n, checked: val, children: n.children ? n.children.map((c) => setChecked(c, val)) : undefined });
  return nodes.map((n) => {
    if (ids.has(n.id)) return setChecked(n, v);
    if (n.children) return { ...n, children: setIdsChecked(n.children, ids, v) };
    return n;
  });
}

export const useParseSession = create<ParseSession>((set, get) => ({
  state: "idle",
  results: [],
  tree: [],
  input: "",
  parseType: "auto",
  autoPages: 1,
  error: undefined,
  setInput: (v) => set({ input: v }),
  setParseType: (t) => set({ parseType: t }),
  setAutoPages: (n) => set({ autoPages: n }),
  start: () => set({ state: "parsing", error: undefined, tree: [] }),
  success: (results) => set({ state: "success", results, tree: buildTree(results) }),
  fail: (error) => set({ state: "error", error }),
  reset: () => set({ state: "idle", results: [], tree: [], input: "", parseType: "auto", error: undefined }),
  toggle: (id) => set((s) => ({ tree: recompute(toggleNode(s.tree, id)) })),
  setAll: (v) => set((s) => ({ tree: recompute(applyAll(s.tree, v)) })),
  invertAll: () => set((s) => ({ tree: recompute(invertAll(s.tree)) })),
  setByIndices: (want) => set((s) => ({ tree: recompute(setByResultIndices(s.tree, want)) })),
  setNodeIdsChecked: (ids, v) => set((s) => ({ tree: recompute(setIdsChecked(s.tree, ids, v)) })),
  rangeToggle: (fromId, toId) => set((s) => ({ tree: recompute(toggleRangeIn(s.tree, fromId, toId)) })),
  toggleCollapse: (id) => set((s) => ({ tree: s.tree.map((n) => (n.id === id ? { ...n, collapsed: !n.collapsed } : n)) })),
  expandAll: (open) => set((s) => {
    const setCollapsed = (ns: TreeNode[], collapsed: boolean): TreeNode[] => ns.map((n) => ({ ...n, collapsed: n.children ? collapsed : n.collapsed, children: n.children ? setCollapsed(n.children, collapsed) : undefined }));
    return { tree: setCollapsed(s.tree, !open) };
  }),
  selectedLeaves: () => collect([], get().tree),
}));
