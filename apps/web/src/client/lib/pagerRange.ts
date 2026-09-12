/**
 * 页码按钮的取值范围 —— 照搬原版 `gui/component/widget/pager.py:79-109` 的 `get_pager_range`。
 *
 * 规则：当前页靠左（≤4）/ 靠右（> total-4）/ 在中间，各取 9 个连续页码；
 * 离首页或末页还远时，把首/尾换成「1 …」或「… N」。
 * 返回 "L"/"R" 表示省略号，点击时原版是跳到 current∓5。
 */
export function pagerRange(current: number, total: number): Array<number | "L" | "R"> {
  const span = (from: number): number[] => Array.from({ length: 9 }, (_, i) => from + i);
  const fromOne = (): number[] => Array.from({ length: total }, (_, i) => i + 1);

  let contiguous: number[];
  if (current <= 4) contiguous = total < 9 ? fromOne() : span(1);
  else if (current > total - 4) contiguous = total < 9 ? fromOne() : span(total - 8);
  else contiguous = span(current - 4);

  const out: Array<number | "L" | "R"> = [...contiguous];
  if ((out[0] as number) > 1) {
    out[0] = 1;
    out[1] = "L";
  }
  if ((out[out.length - 1] as number) < total) {
    out[out.length - 2] = "R";
    out[out.length - 1] = total;
  }
  return out;
}
