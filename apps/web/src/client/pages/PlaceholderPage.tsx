import { Icon } from "../lib/icons";
import type { RouteId } from "../lib/routes";

const PLACEHOLDER: Record<RouteId, { title: string; desc: string; icon: "search" | "download" | "gear"; note?: string }> = {
  parse: { title: "解析", desc: "", icon: "search" },
  downloads: { title: "下载", desc: "", icon: "download" },
  settings: { title: "设置", desc: "", icon: "gear" },
};

export function PlaceholderPage({ route }: { route: RouteId }) {
  const cfg = PLACEHOLDER[route];

  return (
    <section className="page">
      <div className="panel">
        <div className="panel-head">
          <div className="panel-title">{cfg.title}</div>
        </div>
        <div className="empty-state">
          <Icon name={cfg.icon} size={52} />
          <h3>「{cfg.title}」正在建设中</h3>
          <p>{cfg.desc}</p>
        </div>
      </div>
    </section>
  );
}
