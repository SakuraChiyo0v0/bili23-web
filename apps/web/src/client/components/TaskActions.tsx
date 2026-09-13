import {
  cancelTask, pauseTask, resumeTask, retryTask, deleteTask, taskLog, listFiles, fileRawUrl,
} from "../services/client";
import { useTasksStore, TASK_STATUS_META } from "../store/useTasksStore";
import type { TaskSummary } from "../services/types";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../lib/icons";
import { t as tr } from "../lib/i18n";
import { Overlay } from "./Overlay";
import { deliverRawUrl, saveDeliverToDevice, supportsSaveAs } from "../lib/deliverFile";

/** 兼容旧引用（产物页/别处若还用到）；真正的取回逻辑在 `lib/deliverFile.ts` */
export { deliverRawUrl };

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
  /**
   * 「已经取回过了」——取回之后服务端副本就删了，按钮改成不可点 + 文案「已取回」，
   * 而不是让用户点了再吃一个 404（之前就是这样，静默失败）。
   */
  const [deliverTaken, setDeliverTaken] = useState(false);
  /**
   * 完成后**自动试推一次**，但只在"本会话里亲眼看到它从进行中变成完成"时触发。
   *
   * ⚠️ 不能按 `status === "completed"` 就推：那样每次打开「下载完成」页签，
   * 每个本机任务都会自动下载一遍（多个文件会被浏览器拦，用户也不知道发生了什么）。
   */
  const prevStatusRef = useRef<TaskSummary["status"] | null>(null);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = task.status;
    if (!isLocalDeliver || task.status !== "completed" || deliverTaken) return;
    if (prev === null || prev === "completed") return; // 打开页面时已是完成态 → 不自动推，等用户点
    setDeliverTaken(true);
    const timer = window.setTimeout(() => { window.location.href = deliverRawUrl(task.id); }, 400);
    return () => window.clearTimeout(timer);
  }, [isLocalDeliver, task.status, deliverTaken, task.id]);

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
        /**
         * 完成态的主操作 = **把产物取到你现在用的设备**（按钮文案「下载到本机」）。
         * ⚠️ 原来是 `window.open(url, "_blank")` —— 开一个新标签页，
         * 视频会被浏览器内联播放、其它类型才下载，行为不一致，而且标签页里也"打不开"任何东西。
         * 现在统一用 `<a download>` 触发下载（服务端已带 Content-Disposition，文件名以它为准）。
         */
        try {
          const { files } = await listFiles();
          const base = (task.outputPath ? task.outputPath.split(/[\\/]/).pop() : "") ?? "";
          const hit = files.find((f) => f.name === base || f.path.endsWith(base));
          if (!hit) { onToast("产物文件暂不可用（可能已被移动或删除）", "warn"); return; }
          const a = document.createElement("a");
          a.href = fileRawUrl(hit.path);
          a.download = hit.name;   // 只是给浏览器的提示，真正的文件名来自服务端响应头
          document.body.appendChild(a);
          a.click();
          a.remove();
          onToast(`已开始下载：${hit.name}`, "ok");
        } catch {
          onToast("下载失败：请稍后重试，或到「产物」页下载", "err");
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

  /**
   * 「保存到本机」—— 本机模式的**主操作**。
   *
   * ⚠️ 不能用产物库那条路找文件：本机模式的产物在**投递目录**里，`listFiles()`（只列下载目录）
   * 永远找不到 —— 之前主按钮还是「打开」+ 产物库查找，于是本机任务必然报「产物文件暂不可用」。
   *
   * 三种结局都给明确反馈：支持 File System Access 的浏览器弹「另存为」让用户选目录；
   * 不支持的（手机浏览器）退化成普通下载；副本已被取走则提示去浏览器下载文件夹看。
   */
  const saveToDevice = async () => {
    const name = task.outputPath ? task.outputPath.split(/[\\/]/).pop() ?? task.title : task.title;
    const r = await saveDeliverToDevice(task.id, name);
    if (r === "saved") { setDeliverTaken(true); onToast(tr("已保存到本机；服务器副本已删除"), "ok"); return; }
    if (r === "unsupported") { setDeliverTaken(true); onToast(tr("已交给浏览器下载；手机浏览器不能选目录，文件在系统「下载」里"), "ok"); return; }
    if (r === "cancelled") return;
    if (r === "gone") { setDeliverTaken(true); onToast(tr("服务器副本已被取走：请看浏览器的下载文件夹（或重新下载该任务）"), "warn"); return; }
    onToast(tr("保存失败：请重试，或改用「产物」页下载"), "err");
  };


  const openLog = async () => { setLogOpen(true); try { const { lines } = await taskLog(task.id); setLogLines(lines); } catch { setLogLines([]); } };

  // 主按钮图标按原版 `item_delegate.py:getButtonIcon`：
  // 完成 → 文件夹（打开产物）、失败 → 重试、排队/暂停/中断 → 播放、其余 → 暂停
  const iconName = meta.action === "open" ? "download"
    : meta.action === "retry" ? "retry"
      : meta.action === "resume" ? "play"
        : meta.action === "delete" ? "x"
          : "pause";
  /** 本机模式：完成后的主按钮是「保存到本机」而不是「打开」 */
  const primaryIsDeliver = isLocalDeliver && meta.action === "open";

  return (
    <div className="task-actions">
      {primaryIsDeliver ? (
        <button type="button" className="btn sm primary" onClick={() => void saveToDevice()}>
          <Icon name="download" size={15} />
          {deliverTaken ? tr("已取回") : supportsSaveAs() ? tr("另存为…") : tr("保存到本机")}
        </button>
      ) : (
        <button type="button" className="btn sm primary" onClick={act} disabled={meta.action === "none"}>
          <Icon name={iconName} size={15} />
          {/*
            ⚠️ 完成态原来叫「打开」——**名不副实**（用户反馈）：
            原版是桌面程序，"打开"指用系统默认程序打开**这台机器上**的文件；
            而网页部署在 NAS 上，点它实际做的是"把文件取到**你正在用的设备**"，
            对服务端来说"打开"根本没有意义。所以按实际行为改叫「下载到本机」。
          */}
          {meta.action === "pause" ? tr("暂停") : meta.action === "resume" ? tr("继续") : meta.action === "retry" ? tr("重试") : meta.action === "open" ? tr("下载到本机") : tr("删除")}
        </button>
      )}
      <button type="button" className="btn sm ghost" onClick={openLog}>{tr("日志")}</button>
      {meta.action === "pause" && (
        <button type="button" className="btn sm ghost" onClick={() => secondary("cancel")}>{tr("取消")}</button>
      )}
      {meta.action === "open" && (
        <button type="button" className="btn sm ghost" onClick={() => secondary("delete")}>{tr("删除")}</button>
      )}
      {isLocalDeliver && task.status !== "completed" && (
        <span className="small muted" title={tr("服务器不留副本：推送到你的浏览器后会删除")}>{tr("将保存到本机")}</span>
      )}
      <Overlay open={logOpen} onClose={() => setLogOpen(false)} size="md" sheetOnMobile>
            <div className="modal-head"><div className="modal-title">{tr("任务日志")}</div><button type="button" className="icon-btn" onClick={() => setLogOpen(false)} aria-label={tr("关闭")}><svg className="ico" viewBox="0 0 24 24" width={18} height={18}><path d="M6 6l12 12M18 6L6 18" /></svg></button></div>
            <div className="modal-body log-body"><pre>{logLines.length ? logLines.join("\n") : "暂无日志"}</pre></div>
            <div className="modal-foot"><div className="right"><button type="button" className="btn" onClick={() => setLogOpen(false)}>{tr("关闭")}</button></div></div>
          </Overlay>
    </div>
  );
}