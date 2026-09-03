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
  error?: string;
  setInput: (v: string) => void;
  setParseType: (t: string) => void;
  start: () => void;
  success: (results: ParseResult[]) => void;
  fail: (error: string) => void;
  reset: () => void;
  toggle: (nodeId: string) => void;
  setAll: (v: boolean) => void;
  toggleCollapse: (nodeId: string) => void;
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

function applyAll(nodes: TreeNode[], v: boolean): TreeNode[] {
  return nodes.map((n) => ({ ...n, checked: v, children: n.children ? applyAll(n.children, v) : undefined }));
}

export const useParseSession = create<ParseSession>((set, get) => ({
  state: "idle",
  results: [],
  tree: [],
  input: "",
  parseType: "auto",
  error: undefined,
  setInput: (v) => set({ input: v }),
  setParseType: (t) => set({ parseType: t }),
  start: () => set({ state: "parsing", error: undefined, tree: [] }),
  success: (results) => set({ state: "success", results, tree: buildTree(results) }),
  fail: (error) => set({ state: "error", error }),
  reset: () => set({ state: "idle", results: [], tree: [], input: "", parseType: "auto", error: undefined }),
  toggle: (id) => set((s) => ({ tree: recompute(toggleNode(s.tree, id)) })),
  setAll: (v) => set((s) => ({ tree: recompute(applyAll(s.tree, v)) })),
  toggleCollapse: (id) => set((s) => ({ tree: s.tree.map((n) => (n.id === id ? { ...n, collapsed: !n.collapsed } : n)) })),
  selectedLeaves: () => collect([], get().tree),
}));

export function collectAllLeaves(results: ParseResult[]): MediaItem[] {
  const out: MediaItem[] = [];
  for (const r of results) for (const it of r.items) out.push(it);
  return out;
}

import type { TaskSummary } from "../services/types";

interface TasksState {
  tasks: TaskSummary[];
  setTasks: (t: TaskSummary[]) => void;
  upsert: (t: TaskSummary) => void;
}

export const useTasksStore = create<TasksState>((set) => ({
  tasks: [],
  setTasks: (tasks) => set({ tasks }),
  upsert: (t) => set((s) => ({ tasks: [...s.tasks.filter((x) => x.id !== t.id), t] })),
}));