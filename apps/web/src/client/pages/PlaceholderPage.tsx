import { Icon } from "../lib/icons";
import { useToast } from "../lib/toast";
import type { RouteId } from "../lib/routes";

const PLACEHOLDER: Record<RouteId, { title: string; desc: string; icon: "search" | "download" | "gear"; note?: string }> = {
  parse: {
    title: "解析",
    desc: "粘贴链接并解析出可下载条目。该功能将在 P1 阶段接入：输入框、解析树（三态勾选）、分页与自动解析都会按原版交互落地。",
    icon: "search",
  },
  downloads: {
    title: "下载",
    desc: "下载队列将在这里展示，包含下载中 / 已完成双页签、实时进度与任务控制。该功能将在 P2 阶段接入。",
    icon: "download",
    note: "同时提供“预览提示”按钮以展示 Toast 效果。",
  },
  settings: {
    title: "设置",
    desc: "全局设置将在 P4 阶段完整接入：界面、下载、解析交互、附加内容、命名与高级分组，并接后端配置接口。",
    icon: "gear",
  },
};

export function PlaceholderPage({ route }: { route: RouteId }) {
  const { toast } = useToast();
  const cfg = PLACEHOLDER[route];
  const isSettings = route === "settings";

  return (
    <section className="page">
      <div className="panel">
        <div className="panel-head">
          <div className="panel-title">{cfg.title}</div>
          {route === "downloads" && (
            <button type="button" className="btn sm" onClick={() => toast("这是全局提示（Toast），后续用于下载结果与操作反馈。")}>
              预览提示
            </button>
          )}
        </div>
        <div className="empty-state">
          <Icon name={cfg.icon} size={52} />
          <h3>「{cfg.title}」正在建设中</h3>
          <p>{cfg.desc}</p>
          {isSettings ? <MiniSettingsDemo /> : null}
        </div>
      </div>
    </section>
  );
}

function MiniSettingsDemo() {
  return <p className="small muted">提示：右侧“界面外观”卡片已提供主题 / 动效开关，可直接试用。</p>;
}
