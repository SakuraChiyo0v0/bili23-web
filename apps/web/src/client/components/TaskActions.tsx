import {
  cancelTask, pauseTask, resumeTask, retryTask, deleteTask, taskLog, listFiles, fileRawUrl,
} from "../services/client";
import { useTasksStore, TASK_STATUS_META } from "../store/useTasksStore";
import type { TaskSummary } from "../services/types";
import { useEffect, useState } from "react";
import { Icon } from "../lib/icons";
import { t as tr } from "../lib/i18n";
import { Overlay } from "./Overlay";

/** 「保存到本机」的下载地址（服务端推完即删副本）；抽成函数免得各处手拼 URL */
export function deliverRawUrl(taskId: string): string {
  return `/api/deliver/raw?taskId=${encodeURIComponent(taskId)}`;
}

export function TaskActions({
  task,
  onRemove,
  onToast,
}: {
  task: TaskSummary;
  onRemove: (id: string) => void;
  onToast: (msg: string, tone?: "ok" | "err" | "warn" | "info") => void;
}) {
  const [logOpen, setLogOpen] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);
  const meta = TASK_STATUS_META[task.status];
  /** 这个任务选了「保存到：本机」 */
  const isLocalDeliver = task.deliver === "local";
  /** 自动推送试过一次没（按钮文案随之变成「再次保存到本机」） */
  const [deliverTried, setDeliverTried] = useState(false);
  useEffect(() => {
    if (!isLocalDeliver || task.status !== "completed" || deliverTried) return;
    // 完成的那一帧就试着推一次；被浏览器拦了也没关系，按钮一直在
    setDeliverTried(true);
    const timer = window.setTimeout(() => { window.location.href = deliverRawUrl(task.id); }, 300);
    return () => window.clearTimeout(timer);
  }, [isLocalDeliver, task.status, deliverTried, task.id]);

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
        try {
          const { files } = await listFiles();
          const base = (task.outputPath ? task.outputPath.split(/[\\/]/).pop() : "") ?? "";
          const hit = files.find((f) => f.name === base || f.path.endsWith(base));
          if (hit) window.open(fileRawUrl(hit.path), "_blank");
          else onToast("产物文件暂不可用", "warn");
        } catch {
          onToast("无法打开产物文件", "err");
        }
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
      onToast(kind === "cancel" ? tr("已取消") : tr("已删除"), "info");
    } catch (e) {
      onToast(e instanceof Error ? e.message : "操作失败", "err");
    }
  };

  const openLog = async () => { setLogOpen(true); try { const { lines } = await taskLog(task.id); setLogLines(lines); } catch { setLogLines([]); } };

  // 主按钮图标按原版 `item_delegate.py:getButtonIcon`：
  // 完成 → 文件夹（打开产物）、失败 → 重试、排队/暂停/中断 → 播放、其余 → 暂停
  const iconName = meta.action === "open" ? "folder"
    : meta.action === "retry" ? "retry"
      : meta.action === "resume" ? "play"
        : meta.action === "delete" ? "x"
          : "pause";

  return (
    <div className="task-actions">
      <button type="button" className="btn sm primary" onClick={act} disabled={meta.action === "none"}>
        <Icon name={iconName} size={15} />
        {meta.action === "pause" ? tr("暂停") : meta.action === "resume" ? tr("继续") : meta.action === "retry" ? tr("重试") : meta.action === "open" ? tr("打开") : tr("删除")}
      </button>
      <button type="button" className="btn sm ghost" onClick={openLog}>{tr("日志")}</button>
      {meta.action === "pause" && (
        <button type="button" className="btn sm ghost" onClick={() => secondary("cancel")}>{tr("取消")}</button>
      )}
      {meta.action === "open" && (
        <button type="button" className="btn sm ghost" onClick={() => secondary("delete")}>{tr("删除")}</button>
      )}
      {/**
       * 「保存到本机」：只有选了「保存到：本机」的任务才有。
       * 完成的瞬间自动试一次（浏览器对"非用户手势"的下载可能拦截，所以按钮始终在），
       * 用 `<a download>` 触发 —— 点击本身就是用户手势，最稳。
       */}
      {isLocalDeliver && task.status === "completed" && (
        <a className="btn sm primary" href={deliverRawUrl(task.id)} download
          onClick={() => onToast(tr("正在推送到本机…服务器副本会在推送完成后删除"), "info")}>
          <Icon name="download" size={15} />{deliverTried ? tr("再次保存到本机") : tr("保存到本机")}
        </a>
      )}
      {isLocalDeliver && task.status !== "completed" && (
        <span className="small muted" title={tr("服务器不留副本：推送到你的浏览器后会删除")}>{tr("保存到本机")}</span>
      )}
      <Overlay open={logOpen} onClose={() => setLogOpen(false)} size="md" sheetOnMobile>
            <div className="modal-head"><div className="modal-title">{tr("任务日志")}</div><button type="button" className="icon-btn" onClick={() => setLogOpen(false)} aria-label={tr("关闭")}><svg className="ico" viewBox="0 0 24 24" width={18} height={18}><path d="M6 6l12 12M18 6L6 18" /></svg></button></div>
            <div className="modal-body log-body"><pre>{logLines.length ? logLines.join("\n") : "暂无日志"}</pre></div>
            <div className="modal-foot"><div className="right"><button type="button" className="btn" onClick={() => setLogOpen(false)}>{tr("关闭")}</button></div></div>
          </Overlay>
    </div>
  );
}