import {
  cancelTask, pauseTask, resumeTask, retryTask, deleteTask,
} from "../services/client";
import { useTasksStore, TASK_STATUS_META } from "../store/useTasksStore";
import type { TaskSummary } from "../services/types";
import { Icon } from "../lib/icons";

export function TaskActions({
  task,
  onRemove,
  onToast,
}: {
  task: TaskSummary;
  onRemove: (id: string) => void;
  onToast: (msg: string, tone?: "ok" | "err" | "warn" | "info") => void;
}) {
  const meta = TASK_STATUS_META[task.status];

  // 主按钮动作定义，映射到各操作
  const act = async () => {
    try {
      if (meta.action === "pause") {
        await pauseTask(task.id);
        onToast("已暂停", "ok");
      } else if (meta.action === "resume") {
        await resumeTask(task.id);
        onToast("已继续", "ok");
      } else if (meta.action === "retry") {
        await retryTask(task.id);
        onToast("已重新开始", "ok");
      } else if (meta.action === "open") {
        window.open(task.outputPath ? "#files" : "#files", "_self");
      } else if (meta.action === "delete") {
        await deleteTask(task.id);
        onRemove(task.id);
        onToast("已删除", "info");
        return;
      }
      // 操作后触发刷新或等待 SSE；此处先 refresh 兜底
      void useTasksStore.getState().refresh();
    } catch (e) {
      onToast(e instanceof Error ? e.message : "操作失败", "err");
    }
  };

  // 次要操作：取消 / 删除
  const secondary = async (kind: "cancel" | "delete") => {
    try {
      if (kind === "cancel") await cancelTask(task.id);
      else await deleteTask(task.id);
      onRemove(task.id);
      onToast(kind === "cancel" ? "已取消" : "已删除", "info");
    } catch (e) {
      onToast(e instanceof Error ? e.message : "操作失败", "err");
    }
  };

  const iconName = meta.action === "pause" ? "pause" : meta.action === "resume" ? "play" : meta.action === "retry" ? "play" : meta.action === "open" ? "external" : "x";

  return (
    <div className="task-actions">
      <button type="button" className="btn sm primary" onClick={act} disabled={meta.action === "none"}>
        <Icon name={iconName} size={15} />
        {meta.action === "pause" ? "暂停" : meta.action === "resume" ? "继续" : meta.action === "retry" ? "重试" : meta.action === "open" ? "打开" : "删除"}
      </button>
      {meta.action === "pause" && (
        <button type="button" className="btn sm ghost" onClick={() => secondary("cancel")}>取消</button>
      )}
      {meta.action === "open" && (
        <button type="button" className="btn sm ghost" onClick={() => secondary("delete")}>删除</button>
      )}
    </div>
  );
}