import { describe, expect, it } from "vitest";
import { pagerRange } from "../src/client/lib/pagerRange.js";

/**
 * 判据来自原版 `gui/component/widget/pager.py:79-109` 的 get_pager_range。
 * 用「页码序列完全相等」来断言，而不是"看着差不多"—— 省略号出现在哪一位是有讲究的。
 */
describe("pagerRange（移植自原版 get_pager_range）", () => {
  it("总页数小于 9：全部列出来，不出现省略号", () => {
    expect(pagerRange(1, 3)).toEqual([1, 2, 3]);
    expect(pagerRange(2, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pagerRange(5, 8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("当前页靠左：1..9 连续，末两位被替换成「… N」", () => {
    // 原版是把 contiguous[-2] 改成省略号、[-1] 改成末页 —— 也就是**长度仍是 9**，
    // 数字 8 被省略号顶掉了，不是"再插一个省略号"（我第一版期望写成了 10 位，是错的）
    expect(pagerRange(1, 20)).toEqual([1, 2, 3, 4, 5, 6, 7, "R", 20]);
    expect(pagerRange(4, 20)).toEqual([1, 2, 3, 4, 5, 6, 7, "R", 20]);
  });

  it("当前页在中间：首两位与末两位分别被替换", () => {
    // contiguous = [6..14] -> 先 [1,"L",8,9,10,11,12,13,14]，再把 13/14 换成 "R"/20。
    // 长度始终是 9 —— 是**替换**不是插入（这个我连续写错两次，见归档）
    expect(pagerRange(10, 20)).toEqual([1, "L", 8, 9, 10, 11, 12, "R", 20]);
  });

  it("当前页靠右：左侧补首页与省略号", () => {
    // current > total-4 -> 取 total-8..total = [12..20] -> 首两位变 [1,"L"]
    expect(pagerRange(20, 20)).toEqual([1, "L", 14, 15, 16, 17, 18, 19, 20]);
    expect(pagerRange(17, 20)).toEqual([1, "L", 14, 15, 16, 17, 18, 19, 20]);
  });

  it("单页时只有一个按钮", () => {
    expect(pagerRange(1, 1)).toEqual([1]);
  });

  it("首尾都在范围内时不会误插省略号", () => {
    // current<=4 且 total<9 的分支：两端都够近，不该出现 L/R
    expect(pagerRange(1, 8).includes("L")).toBe(false);
    expect(pagerRange(1, 8).includes("R")).toBe(false);
    // 恰好 9 页、当前第 5 页 -> 中间分支，但仍然刚好铺满，无省略号
    expect(pagerRange(5, 9)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});
