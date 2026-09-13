import { hasLocalDir, writeResponseToLocalDir } from "./localDir";
/**
 * 「保存到本机」的客户端逻辑。
 *
 * 背景：选了「保存到：本机」的任务，产物落在服务器的**投递目录**里（不在产物库），
 * 推给浏览器之后服务端就把副本删掉。所以：
 * - **不能用产物库那条路**去找文件（`listFiles()` 只列下载目录）—— 之前任务卡的「打开」
 *   就是这么找的，于是"本机"任务永远报「产物文件暂不可用」（用户实测踩到）。
 * - 取回之后副本就没了，再点要给**明确反馈**，不能静默 404。
 * - 桌面 Chrome/Edge 有 File System Access API，可以让用户**自己选存到哪个目录**；
 *   手机浏览器（含 iOS Safari、Android Chrome）**不支持**，只能进系统下载文件夹 ——
 *   这一点必须在界面上说清楚，不能让人以为是我们没做。
 */

/** 投递下载地址（服务端推完即删副本） */
export function deliverRawUrl(taskId: string): string {
  return `/api/deliver/raw?taskId=${encodeURIComponent(taskId)}`;
}

/** 浏览器是否支持"另存为"（自己选目录/文件名）。手机浏览器基本都不支持 */
export function supportsSaveAs(): boolean {
  return typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker === "function";
}

/** 服务器上还有没有这份投递产物（HEAD，不下载内容） */
export async function deliverAvailable(taskId: string): Promise<boolean> {
  try {
    const res = await fetch(deliverRawUrl(taskId), { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
}

export type SaveResult = "saved" | "unsupported" | "gone" | "cancelled" | "error";

/**
 * 把投递产物存到本机。
 * - 支持 File System Access API 时：弹「另存为…」让用户选目录与文件名，再流式写进去；
 * - 否则退化成普通下载（进浏览器默认下载目录）。
 * 服务端在响应写完后删除副本 —— 所以这里拿到完整响应即代表"已经取走"。
 */
export async function saveDeliverToDevice(taskId: string, suggestedName: string): Promise<SaveResult> {
  const url = deliverRawUrl(taskId);
  // 先探一下有没有（副本可能已经被上一次取走）
  if (!(await deliverAvailable(taskId))) return "gone";

  /**
   * 首选：设置里**授权过本机文件夹** → 直接流式写进去（不弹对话框、大文件不进内存）。
   * 这正是"本机模式能显示本机目录"的实际用途 —— 不只是显示，而是真的落到那个文件夹。
   */
  if (await hasLocalDir()) {
    const res = await fetch(url);
    if (!res.ok) return "gone";
    if (await writeResponseToLocalDir(suggestedName, res)) return "saved";
  }

  type PickerWindow = Window & {
    showSaveFilePicker?: (opts: {
      suggestedName?: string;
      types?: Array<{ description?: string; accept: Record<string, string[]> }>;
    }) => Promise<{ createWritable: () => Promise<{ write: (d: Blob) => Promise<void>; close: () => Promise<void> }> }>;
  };
  const picker = (window as PickerWindow).showSaveFilePicker;

  if (!picker) {
    // 退化路径：交给浏览器的下载（用户能在下载列表里看到）
    const a = document.createElement("a");
    a.href = url;
    a.download = suggestedName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    return "unsupported";
  }

  try {
    const dot = suggestedName.lastIndexOf(".");
    const ext = dot > 0 ? suggestedName.slice(dot) : "";
    const handle = await picker({
      suggestedName,
      types: ext ? [{ description: ext.slice(1).toUpperCase(), accept: { "application/octet-stream": [ext] } }] : undefined,
    });
    const res = await fetch(url);
    if (!res.ok) return "gone";
    const blob = await res.blob();
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return "saved";
  } catch (err) {
    // 用户在系统对话框里点了取消
    if (err instanceof DOMException && err.name === "AbortError") return "cancelled";
    return "error";
  }
}
