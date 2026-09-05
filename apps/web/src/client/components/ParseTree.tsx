import { useMemo, useState } from "react";
import { useParseSession, type TreeNode } from "../store/useParseSession";
import { Icon } from "../lib/icons";

function fmtDur(sec: number): string {
  if (!sec) return "—";
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export function ParseTree() {
  const tree = useParseSession((s) => s.tree);
  const toggle = useParseSession((s) => s.toggle);
  const toggleCollapse = useParseSession((s) => s.toggleCollapse);
  const [search, setSearch] = useState("");

  // 搜索过滤：命中标题(含父级) 的叶子保留；含命中的组自动展开
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return { tree, forcedExpand: new Set<string>() };
    const forced = new Set<string>();
    const walk = (nodes: TreeNode[]): TreeNode[] => {
      return nodes.map((n) => {
        if (n.children) {
          const children = walk(n.children);
          const selfMatch = n.title.toLowerCase().includes(q);
          if (children.length || (selfMatch && n.children)) {
            if (children.length) forced.add(n.id);
            return { ...n, children: children.length ? children : n.children };
          }
          return selfMatch ? { ...n, children: n.children, collapsed: false } : null!;
        }
        return n.title.toLowerCase().includes(q) ? n : null!;
      }).filter(Boolean) as TreeNode[];
    };
    const t = walk(tree).filter(Boolean) as TreeNode[];
    return { tree: t, forcedExpand: forced };
  }, [tree, search]);

  const visibleTree = search.trim() ? filtered.tree : tree;

  const renderRow = (n: TreeNode, depth: number) => {
    const isLeaf = n.kind === "leaf";
    const checked = n.checked === true ? "on" : n.checked === "partial" ? "partial" : "";
    const collapsed = n.collapsed && !filtered.forcedExpand.has(n.id);
    return (
      <div key={n.id}>
        <div
          className={`tree-row${isLeaf ? "" : " group"}${depth > 0 ? " child" : ""}${collapsed ? " collapsed" : ""}`}
          onClick={() => toggle(n.id)}
        >
          <div className="tree-cell">
            <span className="tree-indent" style={{ paddingLeft: depth * 20 }} />
            {isLeaf ? (
              <>
                <span style={{ width: 16 }} />
                <span className={`checkbox ${checked}`}>{checked === "on" ? <Icon name="check" size={12} /> : null}</span>
              </>
            ) : (
              <button type="button" className="tree-chev" aria-label={collapsed ? "展开" : "折叠"} onClick={(e) => { e.stopPropagation(); toggleCollapse(n.id); }}>
                <Icon name={collapsed ? "chevR" : "chevD"} size={16} />
              </button>
            )}
            <span className="tree-num">{n.item?.page ?? ""}</span>
          </div>
          <div className="tree-cell title" title={n.title}>
            {isLeaf && n.item?.cover ? (
              <img className="tree-cover" src={n.item.cover} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
            ) : null}
            <span className="tree-title-text">{n.title}</span>
          </div>
          <div className="tree-cell muted">
            {n.item?.badge ? <span className={`badge${n.item.badge === "充电专属" ? " hot" : ""}`}>{n.item.badge}</span> : n.children ? `（${n.children.length}）` : ""}
          </div>
          <div className="tree-cell muted">{n.item ? fmtDur(n.item.duration) : ""}</div>
          <div className="tree-cell muted col-time">{n.item ? new Date(n.item.pubtime * 1000).toLocaleDateString() : ""}</div>
        </div>
        {n.children && !collapsed && n.children.map((c) => renderRow(c, depth + 1))}
      </div>
    );
  };

  return (
    <div className="tree-wrap">
      <div className="tree-search">
        <Icon name="search" size={16} />
        <input className="text-input" placeholder="搜索标题…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {search && <button type="button" className="btn sm ghost" onClick={() => setSearch("")}>清除</button>}
      </div>
      {visibleTree.length === 0 ? (
        <div className="empty-state"><p>无匹配结果</p></div>
      ) : (
        <div className="tree">
          <div className="tree-header">
            <div className="tree-cell">#</div>
            <div className="tree-cell title">标题</div>
            <div className="tree-cell">标签</div>
            <div className="tree-cell">时长</div>
            <div className="tree-cell col-time">时间</div>
          </div>
          <div className="tree-body">{visibleTree.map((n) => renderRow(n, 0))}</div>
        </div>
      )}
    </div>
  );
}