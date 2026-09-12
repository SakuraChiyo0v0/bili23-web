import type { AutoSelectConditions, AutoSelectMode, MediaItem, ParseResult } from "../services/types.js";

/**
 * 解析完成后的**初始勾选集合**。
 *
 * 依据桌面版两处逻辑：
 *  - `gui/component/parse_list/tree_view.py:396-408`（`update_tree`）：把「链接指向的那一项」
 *    勾上并滚到它，**只有 MANUAL 模式不勾**（但仍记录它，媒体信息预览要用）。
 *  - `gui/interface/parse.py:91-134`（`apply_auto_select`）：再按模式分派 ——
 *    全选 / 条件式（投稿视频看 `user_uploads`、剧集类与课程类看 `bangumi`、其它看 `other`）。
 *
 * ⚠️ 与原版的**已知粒度差异**：原版是树，容器型解析（空间/收藏夹/历史…）的行是"待解析节点"，
 * `other` 条件作用在这些容器行上；我们的引擎是平铺模型（每个视频的分P 直接摊成叶子），
 * 所以这里的"全选"= 该结果下的全部叶子。等第 2 步「多级树 + 二次解析」落地后再对齐粒度。
 */

/** 链接指向项的比对键 → 条目上的字段名 */
const TARGET_FIELD: Record<"cid" | "ep_id" | "section_id", keyof MediaItem> = {
  cid: "cid",
  ep_id: "epId",
  section_id: "sectionId",
};

export const DEFAULT_AUTO_SELECT_CONDITIONS: AutoSelectConditions = { userUploads: 0, bangumi: 0, other: 0 };

/** 条件式里"其它类型"的兜底分支：音频与所有列表型（空间/收藏夹/历史/稍后再看/合集/每周必看） */
function isOtherType(type: string): boolean {
  return !(type === "video" || type === "bangumi" || type === "cheese" || type === "lesson");
}

export function computeAutoChecked(
  results: ParseResult[],
  mode: AutoSelectMode,
  conditions: AutoSelectConditions = DEFAULT_AUTO_SELECT_CONDITIONS,
): Set<string> {
  const checked = new Set<string>();
  if (mode === "manual") return checked;

  if (mode === "all") {
    for (const r of results) for (const it of r.items) checked.add(it.id);
    return checked;
  }

  // 条件式：按内容类型分派（原版 apply_auto_select 的 match category_name）
  for (const r of results) {
    if (r.type === "video") {
      if (conditions.userUploads === 1) for (const it of r.items) checked.add(it.id);
    } else if (r.type === "bangumi") {
      if (conditions.bangumi === 1) {
        // 「正片」= 第一个分节。原版硬编码 `root.children[0].children[0]`（第一个章节节点），
        // 勾它会级联到该分节下所有剧集；我们的解析器已把正片排在第一位（bangumi.ts:#toResult）
        const firstSection = r.items[0]?.sectionTitle;
        for (const it of r.items) if (it.sectionTitle === firstSection) checked.add(it.id);
      }
    } else if (r.type === "cheese" || r.type === "lesson") {
      if (conditions.bangumi === 1) for (const it of r.items) checked.add(it.id);
    } else if (isOtherType(r.type)) {
      if (conditions.other === 1) for (const it of r.items) checked.add(it.id);
    }
  }

  // 链接指向项：条件式下也要勾（原版在树构建时就勾了，与上面的分派互不影响）
  for (const r of results) {
    const target = r.target;
    if (!target) continue;
    const field = TARGET_FIELD[target.key];
    const hit = r.items.find((it) => it[field] === target.value);
    if (hit) checked.add(hit.id);
  }

  return checked;
}
