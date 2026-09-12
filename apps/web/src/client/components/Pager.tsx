import { useState } from "react";
import { pagerRange } from "../lib/pagerRange";
import { useToast } from "../lib/toast";
import { Icon } from "../lib/icons";
import { t as tr } from "../lib/i18n";

/**
 * 分页器（原版 `gui/component/widget/pager.py`）。
 *
 * 结构：`◀ 页码… ▶ 「共 N 页 / M 个」 [跳页图标] [自动解析图标]`，**左对齐**。
 * 页码算法（含省略号位置）在 `lib/pagerRange.ts`，是从原版逐行移植的、有单测。
 *
 * `onAutoParse` 只有解析页会给（原版那个「自动解析分页」按钮）；收藏夹浮层的分页器
 * 是两个都禁用（`set_menu_actions(can_jump_page=True, can_auto_parse=False)`）。
 */
export function Pager({
  page, totalPages, totalItems, onPage, onAutoParse, autoParseRef,
}: {
  page: number;
  totalPages: number;
  totalItems: number;
  onPage: (n: number) => void;
  /** 给了才显示「自动解析分页」按钮（原版对应 AutoParseDialog） */
  onAutoParse?: () => void;
  /** 「自动解析分页」按钮的 ref —— 教学气泡要锚在它上面（原版 `TeachingTip.create(target=auto_parse_btn)`） */
  autoParseRef?: React.MutableRefObject<HTMLElement | null>;
}) {
  const { toast } = useToast();
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpTo, setJumpTo] = useState("");
  const go = (n: number) => {
    // 越界给提示（原版 `jump_to_page.py:15-31`：标题「无效页码」/ 正文「请输入 1 和 {total_pages} 之间的数字」）
    if (n < 1 || n > totalPages) {
      toast(`无效页码：请输入 1 和 ${totalPages} 之间的数字`, "warn");
      return;
    }
    if (n === page) return;
    onPage(n);
  };
  return (
    <div className="pager">
      <button type="button" className="pager-arrow" disabled={page <= 1} onClick={() => go(page - 1)} title={tr("上一页")} aria-label={tr("上一页")}>
        <Icon name="careL" size={12} />
      </button>
      {pagerRange(page, totalPages).map((p, i) =>
        p === "L" || p === "R" ? (
          <button key={`${p}${i}`} type="button" className="pager-num ellipsis"
            onClick={() => go(p === "L" ? page - 5 : page + 5)}>…</button>
        ) : (
          <button key={p} type="button" className={`pager-num${p === page ? " active" : ""}`} onClick={() => go(p)}>{p}</button>
        ),
      )}
      <button type="button" className="pager-arrow" disabled={page >= totalPages} onClick={() => go(page + 1)} title={tr("下一页")} aria-label={tr("下一页")}>
        <Icon name="careR" size={12} />
      </button>
      <span className="pager-count">共 {totalPages} 页 / {totalItems} 个</span>
      <button type="button" className="icon-btn sm" onClick={() => setJumpOpen((v) => !v)} title={tr("跳转到页面")} aria-label={tr("跳转到页面")}>
        <Icon name="external" size={16} />
      </button>
      {onAutoParse && (
        <button type="button" className="icon-btn sm" ref={(el) => { if (autoParseRef) autoParseRef.current = el; }}
          onClick={onAutoParse} title={tr("自动解析分页")} aria-label={tr("自动解析分页")}>
          <Icon name="gear" size={16} />
        </button>
      )}
      {jumpOpen && (
        <span className="pager-jump-wrap">
          <input className="text-input pager-jump" type="number" min={1} max={totalPages} placeholder={tr("页码")}
            value={jumpTo} onChange={(e) => setJumpTo(e.target.value)} aria-label={tr("跳转到页面")}
            onKeyDown={(e) => { if (e.key === "Enter") { go(Number(jumpTo) || 1); setJumpOpen(false); setJumpTo(""); } }} autoFocus />
          <button type="button" className="btn sm" onClick={() => { go(Number(jumpTo) || 1); setJumpOpen(false); setJumpTo(""); }}>{tr("跳转")}</button>
        </span>
      )}
    </div>
  );
}
