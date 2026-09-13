/**
 * 任务列表的**顺序维护**（纯函数，零依赖 —— 便于单测，也便于被 store 复用）。
 *
 * 背景（用户实测）：同时下 20 多话时，列表"1 到 20 一直在轮流转，一直在闪"。
 * 根因是更新任务时把该项"删掉再追加到末尾"，于是每秒多次的进度推送
 * 会让正在下载的任务不断跳到列表末尾；而同一秒创建的任务 `createdAt` 相同、
 * 按创建时间排序对它们**等于没排**，顺序完全由数组决定 → 表现就是疯狂跳动。
 *
 * 所以这里只做两件事，且都**保持既有位置**：
 * - `upsertTask`：已存在 → 原地替换；不存在 → 追加到末尾
 * - `mergeTasks`：批量合并（已存在的不动位置，只补新任务）
 */

export interface Identified {
  id: string;
}

/** 原地替换（保持顺序）；不存在则追加到末尾 */
export function upsertTask<T extends Identified>(list: readonly T[], item: T): T[] {
  const idx = list.findIndex((x) => x.id === item.id);
  if (idx < 0) return [...list, item];
  const out = [...list];
  out[idx] = item;
  return out;
}

/** 批量合并：已存在的不动位置（也不覆盖），只把新任务追加到末尾 */
export function mergeTasks<T extends Identified>(list: readonly T[], incoming: readonly T[]): T[] {
  const known = new Set(list.map((t) => t.id));
  const added = incoming.filter((t) => !known.has(t.id));
  return added.length > 0 ? [...list, ...added] : [...list];
}
