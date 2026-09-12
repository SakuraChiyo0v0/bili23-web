import type { MediaItem } from "../types.js";
import { mapLimit } from "../async/map-limit.js";
import { fetchViewItems } from "./video.js";
import type { ParseContext } from "./types.js";

/**
 * 容器行 → 分P 叶子展开（Web 扁平模型对 space/favlist 等"列表页行无 cid"的等价映射，
 * 见 P2 计划 Task 2.5/2.6 决策）。桌面需二次解析（ReparseWorker）的行在这里直接并发
 * 调 view 平铺成带 cid 的可下载叶子；单条 view 失败（已删除/私有）跳过该行。
 */

export interface ExpandRow {
  bvid: string;
  /** 行级角标（如"充电专属"），存在时覆盖叶子角标；无则沿用 view 自身语义 */
  badge?: string;
}

/** 展开并发窗口（桌面逐行二次解析也是受限并发的） */
const CONCURRENCY = 4;

export async function expandVideoRows(ctx: ParseContext, rows: readonly ExpandRow[]): Promise<MediaItem[]> {
  const groups = await mapLimit(rows, CONCURRENCY, async (row) => {
    try {
      // 二次解析语义：只展开这一行指名的稿件（onlyBvid）。否则收藏夹里一个"属于某合集"的视频
      // 会把整个合集都拉进来 —— 原版靠 `target_episode_info` 做的正是这件事。
      const view = await fetchViewItems(ctx, { bvid: row.bvid }, { onlyBvid: row.bvid });
      if (view.redirectUrl) return [];
      const badge = row.badge ?? "";
      return badge ? view.items.map((item) => ({ ...item, badge })) : view.items;
    } catch {
      return [];
    }
  });
  const items: MediaItem[] = [];
  for (const group of groups) items.push(...group);
  return items;
}