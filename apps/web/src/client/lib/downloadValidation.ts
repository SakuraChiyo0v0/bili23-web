import { t as tr } from "./i18n.js";
/**
 * 下载选项弹窗的三条校验（原版 `gui/dialog/download_options/dialog.py:60-75` 与 `media.py:92-115`）。
 *
 * 抽成纯函数是为了能单测 —— 文案要逐字对齐原版，且"取消要不要继续"是最容易写错的语义：
 * - 原版 `on_check()` 里是 `return dialog.exec()`：**用户点取消 = 不继续**，选项弹窗保持打开；
 * - 未选任何内容那条是 `hideCancelButton()` 的**纯提示**，点确定后同样不继续。
 */
export interface DownloadFormState {
  video: boolean;
  audio: boolean;
  merge: boolean;
  /** 是否勾了任一类附加文件（弹幕/字幕/封面/章节/元数据） */
  hasExtra: boolean;
}

export type DownloadValidation =
  | { kind: "ok" }
  /** 纯提示（只有确定） */
  | { kind: "notice"; title: string; body: string }
  /** 需要确认（确定=继续，取消=不继续） */
  | { kind: "confirm"; title: string; body: string; confirmText: string; cancelText: string };

export function validateDownloadForm(f: DownloadFormState): DownloadValidation {
  // ① 什么都没选（`dialog.py:63-75`）
  if (!f.video && !f.audio && !f.hasExtra) {
    return {
      kind: "notice",
      title: tr("未选择任何文件进行下载"),
      body: tr("请至少选择下载独立视频流、音频流或附加文件中的一个。"),
    };
  }
  // ② 只下视频流 → 无声视频（`media.py:98-105`）
  if (f.video && !f.audio) {
    return {
      kind: "confirm",
      title: tr("重要提示"),
      body: tr("仅下载视频流将导致视频没有声音。\n\n如果确实需要无声视频，可继续操作；否则请同时勾选音频流。"),
      confirmText: tr("继续"),
      cancelText: tr("取消"),
    };
  }
  // ③ 音视频都要但不合并 → 两个独立文件（`media.py:107-115`）
  if (f.video && f.audio && !f.merge) {
    return {
      kind: "confirm",
      title: tr("重要提示"),
      body: tr("未启用“合并视频和音频”，将分别下载两个独立文件。\n\n如需得到单个完整视频文件，请启用“合并视频和音频”。"),
      confirmText: tr("继续"),
      cancelText: tr("取消"),
    };
  }
  return { kind: "ok" };
}
