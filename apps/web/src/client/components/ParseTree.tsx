import { useEffect, useMemo, useRef, useState } from "react";
import { useParseSession, type TreeNode } from "../store/useParseSession";
import type { MediaItem } from "../services/types";
import { useToast } from "../lib/toast";
import { COLUMN_LABEL, useParseListPrefs, type ColumnKey } from "../lib/parseListPrefs";
import { dynTimeKey, dynTimeLabel, sortTree, type SortKey } from "../lib/parseTree";
import { Icon } from "../lib/icons";
import { Overlay } from "./Overlay";
import { t as tr } from "../lib/i18n";
import { cancelLongPress, longPressStart, shouldSwallowClick } from "../lib/longPress";

function fmtDur(sec: number): string {
  if (!sec) return "—";
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * 行 DOM id —— 底部「搜索结果」的上下跳转要靠它定位（原版是 `scroll_to_item`）。
 * 解析页侧用 `scrollToTreeNode()` 找元素，两边必须走同一套拼法。
 */
export function treeNodeDomId(nodeId: string): string {
  return `tree-node-${nodeId}`;
}

/** 滚动到某个节点所在行（原版 `ParseInterface.scroll_to_item`） */
export function scrollToTreeNode(nodeId: string): void {
  document.getElementById(treeNodeDomId(nodeId))?.scrollIntoView({ block: "center", behavior: "smooth" });
}

export function ParseTree({ onDownloadOne, onParseItem, onUpdateMediaInfo, onViewParts, matchIds, activeMatchId }: {
  onDownloadOne?: (item: MediaItem) => void;
  /** 「解析此项」「下载为单个视频」等菜单动作都回到解析页处理（原版是发信号给 ParseInterface） */
  onParseItem?: (url: string) => void;
  onUpdateMediaInfo?: (item: MediaItem) => void;
  /** 「查看分P视频列表」（原版悬浮命令条的中间按钮；仅收藏夹内的分P视频可用） */
  onViewParts?: (item: MediaItem) => void;
  /** 搜索命中的节点 id（原版把关键词交给 model 做高亮，不过滤掉未命中的行） */
  matchIds?: Set<string>;
  /** 当前定位到的那一个命中项（原版 SearchWidget 的"第 x 个"） */
  activeMatchId?: string | null;
}) {
  const tree = useParseSession((s) => s.tree);
  const results = useParseSession((s) => s.results);
  const toggle = useParseSession((s) => s.toggle);
  const toggleCollapse = useParseSession((s) => s.toggleCollapse);
  const rangeToggle = useParseSession((s) => s.rangeToggle);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; node: TreeNode } | null>(null);
  /**
   * ⚠️ 这两个弹窗的状态必须放在 ParseTree，不能放在 RowMenu 里 ——
   * 点菜单项会先 onClose() 把 RowMenu **卸载**，放在里面的 state 会跟着没，
   * 表现就是"点了「查看元数据」什么都没发生"（实测踩过）。
   */
  const [metaNode, setMetaNode] = useState<TreeNode | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [prefs, setPrefs] = useParseListPrefs();
  const { toast } = useToast();
  /**
   * 悬浮命令栏开关（原版 `parse_list_show_floating_command_bar`）。
   * ⚠️ 触屏设备上必须无视这个开关：手机没有右键，⋮ 是**唯一**入口，
   * 关掉它等于把 12 项菜单（全选/解析此项/查看分P/复制链接…）全锁死。
   */
  const coarsePointer = typeof window !== "undefined" && window.matchMedia?.("(hover:none)").matches === true;
  const floatingBar = prefs.floatingBar || coarsePointer;
  /** 排序状态（原版 `setSortingEnabled(True)`：点表头排序，再点切换升降序） */
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean } | null>(null);
  const dragRef = useRef<{ key: ColumnKey; startX: number; startW: number } | null>(null);

  const visible = prefs.columns.filter((c) => c.show);
  /** 窄屏只留前两列（序号 + 标题），其余靠展开行看 —— 设计稿 §三解析页的规则 */
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width:767px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width:767px)");
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const shown = narrow ? visible.slice(0, 2) : visible;
  const gridOf = (cols: typeof visible) => cols.map((c) => (c.key === "title" ? "minmax(200px,1fr)" : `${c.width}px`)).join(" ");
  const timeKey = dynTimeKey(results);
  const timeLabel = dynTimeLabel(results);

  const columnTitle = (k: ColumnKey): string => tr(k === "dyn_time" ? timeLabel : COLUMN_LABEL[k]);

  /** 排序：原版是对每一层 children 递归排序（`model.py:226-258`） */
  const sorted = useMemo(
    () => (sort ? sortTree(tree, sort.key, sort.desc, timeKey) : tree),
    [tree, sort, timeKey],
  );

  // 关键词搜索不再在树里做过滤：命中项由解析页算出后传进来，只高亮 + 可跳转/批量勾选
  //（原版 `tree_view.py:651 search_keywords` 也只设置高亮、不动可见性）


  /** 列宽拖拽（原版表头可拖拽；触屏没有 hover，靠 CSS 隐藏手柄） */
  const onResizeStart = (e: React.MouseEvent, key: ColumnKey, width: number) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { key, startX: e.clientX, startW: width };
    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const next = Math.max(60, d.startW + (ev.clientX - d.startX));
      setPrefs({ columns: prefs.columns.map((c) => (c.key === d.key ? { ...c, width: next } : c)) });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const clickHeader = (k: ColumnKey) => {
    setSort((prev) => (prev?.key === k ? { key: k, desc: !prev.desc } : { key: k, desc: false }));
  };

  let rowSeq = 0;
  /** 入场交错用的行序号：**组行与叶子都算**（用叶子序号会让组行全挤在 0 延迟上，级联不连续） */
  let rowIndex = 0;
  const renderRow = (n: TreeNode, depth: number) => {
    const myRowIndex = Math.min(rowIndex++, 12);
    const isLeaf = n.kind === "leaf";
    const checked = n.checked === true ? "on" : n.checked === "partial" ? "partial" : "";
    const collapsed = n.collapsed === true;
    const isMatch = matchIds?.has(n.id) === true;
    if (isLeaf) rowSeq += 1;
    const zebraOn = isLeaf && prefs.zebraRows && rowSeq % 2 === 0;

    const cell = (k: ColumnKey) => {
      switch (k) {
        case "number":
          return (
            <div className="tree-cell" key={k}>
              <span className="tree-indent" style={{ paddingLeft: depth * 20 }} />
              {isLeaf ? (
                <>
                  <span style={{ width: 16 }} />
                  <span className={`checkbox ${checked}`}>{checked === "on" ? <Icon name="check" size={12} /> : null}</span>
                </>
              ) : (
                <button type="button" className="tree-chev" aria-label={collapsed ? tr("展开") : tr("折叠")} onClick={(e) => { e.stopPropagation(); toggleCollapse(n.id); }}>
                  {/* 固定用 chevD，折叠时靠 CSS 转 -90° —— 换图标是"跳变"，转起来才是过渡 */}
                  <Icon name="chevD" size={16} />
                </button>
              )}
              <span className={`tree-num${isLeaf ? "" : " layer"}`}>{isLeaf ? rowSeq : tr(n.label ?? "")}</span>
            </div>
          );
        case "title":
          return (
            <div className="tree-cell title" key={k} title={n.title}>
              {isLeaf && n.item?.cover ? (
                <img className="tree-cover" src={n.item.cover} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
              ) : null}
              <span className="tree-title-text">{n.title}</span>
            </div>
          );
        case "badge":
          return (
            <div className="tree-cell muted" key={k}>
              {n.item?.badge ? <span className={`badge${n.item.badge === "充电专属" ? " hot" : ""}`}>{n.item.badge}</span> : n.children ? `（${n.children.length}）` : ""}
            </div>
          );
        case "duration":
          return <div className="tree-cell muted" key={k}>{n.item ? fmtDur(n.item.duration) : ""}</div>;
        case "dyn_time": {
          const t = n.item?.[timeKey] as number | undefined;
          return <div className="tree-cell muted col-time" key={k}>{t ? new Date(t * 1000).toLocaleDateString() : ""}</div>;
        }
        default:
          return null;
      }
    };

    const gridTemplate = gridOf(shown);

    return (
      <div key={n.id}>
        <div
          id={treeNodeDomId(n.id)}
          className={`tree-row${isLeaf ? "" : " group"}${depth > 0 ? " child" : ""}${collapsed ? " collapsed" : ""}${zebraOn ? " zebra" : ""}${isMatch ? " search-hit" : ""}${activeMatchId === n.id ? " search-hit-active" : ""}`}
          style={{ gridTemplateColumns: gridTemplate, ["--i"]: myRowIndex } as React.CSSProperties}
          onClick={(e) => {
            if (shouldSwallowClick()) return; // 长按刚开过菜单，别顺手把它勾选/展开了
            if (e.shiftKey && isLeaf && anchor) { rangeToggle(anchor, n.id); return; }
            toggle(n.id);
            if (isLeaf) setAnchor(n.id);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, node: n });
          }}
          /* 触屏：长按 = 右键（第二入口，主要入口是行右侧常驻的 ⋯） */
          onTouchStart={(e) => longPressStart(e, (x, y) => setMenu({ x, y, node: n }))}
          onTouchEnd={cancelLongPress}
          onTouchMove={cancelLongPress}
          onTouchCancel={cancelLongPress}
        >
          {shown.map((c) => cell(c.key))}
          {/* 行上「⋯」= 触屏替代右键（设计稿：桌面 hover 浮现、触屏常驻，共用同一份菜单项）。
              原版对应的是「悬浮命令栏」，由 parse_list_show_floating_command_bar 开关控制。 */}
          {floatingBar && (
            <button
              type="button"
              className="row-more"
              title={tr("更多")}
              aria-label={tr("更多")}
              onClick={(e) => { e.stopPropagation(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMenu({ x: r.right, y: r.bottom + 2, node: n }); }}
            >⋯</button>
          )}
        </div>
        {n.children && !collapsed && n.children.map((c) => renderRow(c, depth + 1))}
      </div>
    );
  };

  return (
    <div className="tree-wrap">
      {sorted.length === 0 ? (
        <div className="empty-state"><p>{tr("没有可显示的条目")}</p></div>
      ) : (
        <div className={`tree${prefs.zebraRows ? " zebra" : ""}`}>
          <div className="tree-header" style={{ gridTemplateColumns: gridOf(shown) }}>
            {shown.map((c) => (
              <div
                key={c.key}
                className={`tree-cell${c.key === "title" ? " title" : ""}${c.key === "dyn_time" ? " col-time" : ""} sortable`}
                onClick={() => clickHeader(c.key)}
                title={`按「${columnTitle(c.key)}」排序`}
              >
                <span className="th-label">{columnTitle(c.key)}</span>
                {sort?.key === c.key && <Icon name={sort.desc ? "chevD" : "chevD"} size={13} {...(sort.desc ? {} : { style: { transform: "rotate(180deg)" } })} />}
                {c.key !== "title" && (
                  <span className="col-resize" onMouseDown={(e) => onResizeStart(e, c.key, c.width)} onClick={(e) => e.stopPropagation()} />
                )}
              </div>
            ))}
          </div>
          <div className="tree-body">{sorted.map((n) => renderRow(n, 0))}</div>
        </div>
      )}
      {menu && (
        <RowMenu
          menu={menu}
          onClose={() => setMenu(null)}
          onDownloadOne={onDownloadOne}
          onParseItem={onParseItem}
          onUpdateMediaInfo={onUpdateMediaInfo}
          onViewParts={onViewParts}
          onViewMetadata={setMetaNode}
          onViewCover={setCoverUrl}
        />
      )}

      {/* 查看元数据（原版 MessageBox；它把「取消」改成了「复制」） */}
      <Overlay open={metaNode !== null} onClose={() => setMetaNode(null)} size="md">
        <div className="modal-head">
          <div className="modal-title">{tr("元数据")}</div>
          <button type="button" className="icon-btn" onClick={() => setMetaNode(null)} aria-label={tr("关闭")}><Icon name="x" size={18} /></button>
        </div>
        <div className="modal-body">
          <pre className="meta-pre">{metaNode ? metadataText(metaNode) : ""}</pre>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={() => { if (metaNode) void navigator.clipboard?.writeText(metadataText(metaNode)); toast(tr("已复制"), "ok"); }}>{tr("复制")}</button>
          <div className="right"><button type="button" className="btn" onClick={() => setMetaNode(null)}>{tr("关闭")}</button></div>
        </div>
      </Overlay>

      {/* 查看封面（原版是独立小窗 + 另存为；Web 改为弹层预览 + 下载） */}
      <Overlay open={coverUrl !== null} onClose={() => setCoverUrl(null)} size="md" sheetOnMobile centerOnMobile>
        <div className="modal-head">
          <div className="modal-title">{tr("封面")}</div>
          <button type="button" className="icon-btn" onClick={() => setCoverUrl(null)} aria-label={tr("关闭")}><Icon name="x" size={18} /></button>
        </div>
        <div className="modal-body center">
          {coverUrl ? <img className="cover-preview" src={coverUrl} alt="" referrerPolicy="no-referrer" /> : null}
        </div>
        <div className="modal-foot">
          <div className="right">
            <a className="btn" href={coverUrl ?? undefined} target="_blank" rel="noreferrer" download>{tr("下载封面")}</a>
            <button type="button" className="btn" onClick={() => setCoverUrl(null)}>{tr("关闭")}</button>
          </div>
        </div>
      </Overlay>
    </div>
  );
}

/**
 * 行右键菜单 —— 项与顺序照搬原版 `tree_view.py:580-604`：
 *   全选/取消全选 · 反选 · ─── · 勾选/取消勾选 ｜ 叶子再加：解析此项 · 在浏览器中打开 ·
 *   下载为单个视频 · 更新媒体信息 · ─── · 查看元数据 ｜ 叶子再加：查看封面
 * 文字按当前状态切换（`Check All`↔`Uncheck All`、`Check Item`↔`Uncheck Item`）。
 */
function RowMenu({ menu, onClose, onDownloadOne, onParseItem, onUpdateMediaInfo, onViewParts, onViewMetadata, onViewCover }: {
  menu: { x: number; y: number; node: TreeNode };
  onClose: () => void;
  onDownloadOne?: (item: MediaItem) => void;
  onParseItem?: (url: string) => void;
  onUpdateMediaInfo?: (item: MediaItem) => void;
  /** 「查看分P视频列表」（原版悬浮命令条中间那个按钮） */
  onViewParts?: (item: MediaItem) => void;
  onViewMetadata: (node: TreeNode) => void;
  onViewCover: (url: string) => void;
}) {
  const session = useParseSession();
  const { toast } = useToast();
  const { node, x, y } = menu;
  const isLeaf = node.kind === "leaf";
  const item = node.item;
  const act = (fn: () => void) => { fn(); onClose(); };

  const allChecked = session.tree.every((n) => n.checked === true);

  return (
    <div className="ctx-layer" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }}>
      <div className="ctx-menu" style={{ left: Math.min(x, window.innerWidth - 210), top: Math.min(y, window.innerHeight - 320) }} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="ctx-item" onClick={() => act(() => session.setAll(!allChecked))}>{allChecked ? tr("取消全选") : tr("全选")}</button>
        <button type="button" className="ctx-item" onClick={() => act(() => session.invertAll())}>{tr("反选")}</button>
        <div className="ctx-sep" />
        <button type="button" className="ctx-item" onClick={() => act(() => session.toggle(node.id))}>{node.checked === true ? tr("取消勾选") : tr("勾选")}</button>

        {isLeaf && item && (
          <>
            <button type="button" className="ctx-item" onClick={() => act(() => onParseItem?.(item.url))}>{tr("解析此项")}</button>
            {/* 原版悬浮命令条中间那个按钮：默认禁用，只有"收藏夹里的分P视频"才启用
                （`tree_view.py:205-211,294-295` 的 FAVORITE_WITH_MULTI_PART_VIDEO_BIT）。
                ⚠️ 判据必须用**条目自己的来源容器** `item.containerType`，不能用 session.parseType ——
                后者是"用户选的解析类型"，自动识别（type=auto）解析收藏夹时它仍是 "auto"，
                真机实测时正是这样把入口误判成禁用的。 */}
            <button type="button" className="ctx-item"
              disabled={!(item.containerType === "favlist" && (item.partCount ?? 0) > 1)}
              title={item.containerType === "favlist" && (item.partCount ?? 0) > 1 ? "" : tr("仅收藏夹内的分P视频可用")}
              onClick={() => act(() => onViewParts?.(item))}>{tr("查看分P视频列表")}</button>
            <button type="button" className="ctx-item" disabled={!item.url} onClick={() => act(() => window.open(item.url, "_blank", "noopener"))}>{tr("在浏览器中打开")}</button>
            <button type="button" className="ctx-item" onClick={() => act(() => onDownloadOne?.(item))}>{tr("下载为单个视频")}</button>
            <button type="button" className="ctx-item" onClick={() => act(() => onUpdateMediaInfo?.(item))}>{tr("更新媒体信息")}</button>
          </>
        )}

        <div className="ctx-sep" />
        <button type="button" className="ctx-item" onClick={() => act(() => onViewMetadata(node))}>{tr("查看元数据")}</button>
        {isLeaf && item && (
          <button type="button" className="ctx-item" disabled={!item.cover} onClick={() => act(() => onViewCover(item.cover))}>{tr("查看封面")}</button>
        )}
        {/* 这一项是我们额外加的（原版菜单里没有），保留是因为好用 */}
        <button type="button" className="ctx-item" onClick={() => act(() => { void navigator.clipboard?.writeText(item?.url ?? node.title); toast(tr("链接已复制"), "ok"); })}>{tr("复制链接")}</button>
      </div>
    </div>
  );
}

/** 元数据文本：原版是 `to_dict()` 的 "key: value" 逐行 */
function metadataText(node: TreeNode): string {
  const it = node.item;
  const rows: Array<[string, unknown]> = [
    ["number", node.seq ?? ""],
    ["title", node.title],
    ["badge", it?.badge ?? ""],
    ["duration", it?.duration ?? ""],
    ["pubtime", it?.pubtime ?? ""],
    ["aid", it?.aid ?? ""],
    ["bvid", it?.bvid ?? ""],
    ["cid", it?.cid ?? ""],
    ["ep_id", it?.epId ?? ""],
    ["page", it?.page ?? ""],
    ["part_count", it?.partCount ?? ""],
    ["collection_title", it?.collectionTitle ?? ""],
    ["section_title", it?.sectionTitle ?? ""],
    ["parent_title", it?.containerTitle ?? ""],
    ["owner", it?.owner?.name ?? ""],
    ["owner_id", it?.owner?.mid ?? ""],
    ["url", it?.url ?? ""],
    ["cover", it?.cover ?? ""],
  ];
  return rows.map(([k, v]) => `${k}: ${v}`).join("\n");
}
