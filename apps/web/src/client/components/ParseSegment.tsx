import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "../lib/icons";
import { t as tr, trp } from "../lib/i18n";

/** 底部组件：搜索结果 / 分页（原版 `component/widget/segment.py` 的两个 stack 页） */
export type ParseBottomView = "search" | "pager";

export interface ParseSearchState {
  keyword: string;
  count: number;
  /** 当前定位到第几个命中项（0 起） */
  index: number;
  onPrev: () => void;
  onNext: () => void;
  onSelectAll: () => void;
  onClear: () => void;
}

/**
 * 底部组件切换（原版 `SegmentedWidget`）：
 * 左侧一个按钮拉出菜单，在「搜索结果」和「分页」两个组件之间切换。
 *
 * 文案逐字对齐原版：`Search results`=搜索结果 / `Pagination`=分页 /
 * `No matches found`=未找到匹配项 / `{index} of {count}`=第 {index} 个，共 {count} 个 /
 * `Select All`=全选 / `Clear All`=清除（见 docs/parity/原版界面文案-按文件.md）。
 */
export function ParseSegment({ view, onView, hasPager, hasSearch, pager, search }: {
  view: ParseBottomView;
  onView: (v: ParseBottomView) => void;
  hasPager: boolean;
  hasSearch: boolean;
  pager?: ReactNode;
  search?: ParseSearchState | null;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // 点空白处收起菜单（触屏没有 hover，不能只靠 mouseleave）
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  if (!hasPager && !hasSearch) return null;

  // 只有分页时不给切换菜单（原版也是：没有搜索结果就没有第二个选项可切）
  const canSwitch = hasPager && hasSearch;
  const active: ParseBottomView = view === "search" && hasSearch ? "search" : hasPager ? "pager" : "search";

  return (
    <div className="seg-widget" ref={wrapRef}>
      {canSwitch ? (
        <div className="seg-choice-wrap">
          <button type="button" className="btn sm seg-choice" onClick={() => setMenuOpen((v) => !v)}>
            {active === "search" ? tr("搜索结果") : tr("分页")} <Icon name="chevD" size={13} />
          </button>
          {menuOpen && (
            <div className="seg-menu" role="menu">
              <button type="button" className="ctx-item" role="menuitem" onClick={() => { onView("search"); setMenuOpen(false); }}>
                <Icon name="search" size={15} /> 搜索结果
              </button>
              <button type="button" className="ctx-item" role="menuitem" onClick={() => { onView("pager"); setMenuOpen(false); }}>
                <Icon name="careR" size={15} /> 分页
              </button>
            </div>
          )}
        </div>
      ) : null}
      <div className="seg-stack">
        {active === "search" && search ? (
          <div className="seg-search">
            <span className="seg-matches">
              {search.count === 0
                ? tr("未找到匹配项")
                : trp("第 {index} 个，共 {count} 个", { index: search.index + 1, count: search.count })}
            </span>
            <button type="button" className="icon-btn sm" title={tr("上一个")} aria-label={tr("上一个")} disabled={search.count === 0} onClick={search.onPrev}>
              <Icon name="careL" size={15} />
            </button>
            <button type="button" className="icon-btn sm" title={tr("下一个")} aria-label={tr("下一个")} disabled={search.count === 0} onClick={search.onNext}>
              <Icon name="careR" size={15} />
            </button>
            <button type="button" className="btn sm" disabled={search.count === 0} onClick={search.onSelectAll}>{tr("全选")}</button>
            <button type="button" className="btn sm" onClick={search.onClear}>{tr("清除")}</button>
          </div>
        ) : (
          pager
        )}
      </div>
    </div>
  );
}
