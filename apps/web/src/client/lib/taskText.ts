import type { TaskSummary } from "../services/types.js";
import { t as tr } from "./i18n.js";

/**
 * 任务卡三个文本字段的取值规则 —— 逐条照搬原版
 * `gui/component/download_list/item_delegate.py` 的 `UIData`。
 * 抽成纯函数是为了能单测这几条"看着差不多、其实有讲究"的规则。
 *
 * ⚠️ 这里**不引用 store**（`useTasksStore`）。原因：本模块被单测引入后会被服务端 tsconfig
 * （node16 + 一堆更严的开关）检查，而 store 里的写法过不了那套开关。依赖方向反过来更干净：
 * 状态文案放在这里，store 引用它。
 */

/** 状态文案（原版 `TIP_MESSAGES` / `ERROR_MESSAGES` 的简中译文）—— 这些也是 i18n 字典的**键**，
 *  所以**表里存简中**、在取用处才 `tr(...)`（表是模块级常量，在这里翻译只会算一次、切语言不生效）。 */
export const TASK_STATUS_LABEL: Record<TaskSummary["status"], string> = {
  queued: "排队中",
  parsing: "解析中",
  downloading: "下载中",
  merging: "合并中",
  paused: "已暂停",
  interrupted: "已中断",
  failed: "失败",
  completed: "已完成",
  cancelled: "已取消",
};

/** 字节数格式化（原版 `Units.format_file_size` 的等价物） */
export function fmtBytes(b?: number): string {
  if (!b) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, n = b;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i > 1 ? 1 : 0)} ${u[i]}`;
}

/** 下载速率（字节/秒 → "1.2 MB/s"）。原版 `Units.format_speed`；无样本返回空串 */
export function fmtSpeed(bps?: number): string {
  if (!bps || bps <= 0) return "";
  const mbps = bps / 1024 / 1024;
  return mbps >= 1 ? `${mbps.toFixed(1)} MB/s` : `${Math.max(1, Math.round(bps / 1024))} KB/s`;
}

/** 这些状态**只显示总量**（原版 `getSizeText` 里那一串状态：完成 / 排队合并 / 合并中 / 转换中 / FFmpeg 失败） */
const TOTAL_ONLY_STATUSES: TaskSummary["status"][] = ["completed", "merging", "cancelled"];

/** 大小：总量为 0 留空；否则「已下 / 总量」，但 TOTAL_ONLY_STATUSES 只给总量 */
export function taskSizeText(task: TaskSummary): string {
  if (task.totalBytes <= 0) return "";
  if (TOTAL_ONLY_STATUSES.includes(task.status)) return fmtBytes(task.totalBytes);
  return `${fmtBytes(task.downloadedBytes)} / ${fmtBytes(task.totalBytes)}`;
}

/**
 * 状态文本：**下载中显示的是速度**（不是"下载中"三个字）；
 * 合并中带百分比，但进度为 0 时不带（原版 `getFFmpegStatusText` 的注释：
 * "FFmpeg 要吐出第一条进度才有百分比可显示，免得挂着一个始终停在 0% 的数字"）。
 */
export function taskStatusText(task: TaskSummary): string {
  const label = tr(TASK_STATUS_LABEL[task.status] ?? task.status);
  /**
   * 下载中：显示「状态 + 速度」，例如「下载中 5.7 MB/s」。
   * ⚠️ 原来**只返回速度**，而速度采样有取不到值的时候（`fmtSpeed` 对空值返回空串）
   * → 状态那一格就整个空着（用户截图里第一张正在下载的卡片就是这样）；
   * 而且速度文字稍长就会被挤到截断。现在速度和标签都在，任一取不到也不会空白。
   */
  if (task.status === "downloading") {
    const speed = fmtSpeed(task.speedBps);
    return speed ? `${label} ${speed}` : label;
  }
  if (task.status === "merging") return task.progress > 0 ? `${label} ${Math.min(100, Math.max(0, task.progress))}%` : label;
  return label;
}

/** 副标题：完成时是**完成时间**，否则是信息标签（原版 `getInfoText`） */
export function taskInfoText(task: TaskSummary): string {
  if (task.status === "completed") return new Date(task.updatedAt * 1000).toLocaleString();
  return task.groupTitle || "";
}
