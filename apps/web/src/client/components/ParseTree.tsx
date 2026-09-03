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

  const renderRow = (n: TreeNode, depth: number) => {
    const isLeaf = n.kind === "leaf";
    const checked = n.checked === true ? "on" : n.checked === "partial" ? "partial" : "";
    return (
      <div key={n.id}>
        <div
          className={`tree-row${isLeaf ? "" : " group"}${depth > 0 ? " child" : ""}${n.collapsed ? " collapsed" : ""}`}
          onClick={() => {
            if (isLeaf) toggle(n.id);
            else toggleCollapse(n.id);
          }}
        >
          <div className="tree-cell">
            <span className="tree-indent" style={{ paddingLeft: depth * 20 }} />
            {isLeaf ? (
              <>
                <span style={{ width: 16 }} />
                <span className={`checkbox ${checked}`}>{checked === "on" ? <Icon name="check" size={12} /> : null}</span>
              </>
            ) : (
              <Icon name={n.collapsed ? "chevR" : "chevD"} size={16} />
            )}
            <span className="tree-num">{n.item?.page ?? ""}</span>
          </div>
          <div className="tree-cell title" title={n.title}>{n.title}</div>
          <div className="tree-cell muted">
            {n.item?.badge ? <span className={`badge${n.item.badge === "充电专属" ? " hot" : ""}`}>{n.item.badge}</span> : n.children ? `（${n.children.length}）` : ""}
          </div>
          <div className="tree-cell muted">{n.item ? fmtDur(n.item.duration) : ""}</div>
          <div className="tree-cell muted col-time">{n.item ? new Date(n.item.pubtime * 1000).toLocaleDateString() : ""}</div>
        </div>
        {n.children && !n.collapsed && n.children.map((c) => renderRow(c, depth + 1))}
      </div>
    );
  };

  if (!tree.length) return <div className="empty-state"><p>解析结果为空</p></div>;

  return (
    <div className="tree">
      <div className="tree-header">
        <div className="tree-cell">#</div>
        <div className="tree-cell title">标题</div>
        <div className="tree-cell">标签</div>
        <div className="tree-cell">时长</div>
        <div className="tree-cell col-time">时间</div>
      </div>
      <div className="tree-body">{tree.map((n) => renderRow(n, 0))}</div>
    </div>
  );
}
