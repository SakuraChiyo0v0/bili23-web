/**
 * 画质 / 音质 / 编码的**优先级**标签与默认值。
 *
 * 数值取自引擎 `constants/quality.ts`（与桌面版 `media_info.py` 对齐），
 * 标签取自桌面版 `zh_CN.ts` 的 `VIDEO_QUALITY` / `AUDIO_QUALITY` / `VIDEO_CODEC` 译文。
 * 默认数组逐项照抄桌面版 `config.py:73-100`。
 *
 * ⚠️ 优先级列表里**不含 AUTO**（200 / 30300 / 20）—— 优先级是给"自动选择"排序用的，
 * 把"自动"本身放进去没有意义，桌面版也是这么定的。
 */

import { t as tr } from "./i18n.js";

export type PriorityKind = "video" | "audio" | "codec";

export const PRIORITY_LABELS: Record<PriorityKind, Readonly<Record<number, string>>> = {
  video: {
    127: "8K 超高清",
    126: "杜比视界",
    125: "HDR 真彩",
    122: "4K SDR 增强",
    120: "4K 超高清",
    116: "1080P 60帧",
    112: "1080P 高码率",
    100: "智能修复",
    80: "1080P 高清",
    64: "720P 准高清",
    32: "480P 标清",
    16: "360P 流畅",
  },
  audio: {
    30251: "Hi-Res 无损",
    30250: "杜比全景声",
    30280: "192K",
    30232: "132K",
    30216: "64K",
  },
  codec: {
    7: "AVC/H.264",
    12: "HEVC/H.265",
    13: "AV1",
  },
};

/** 默认优先级（桌面版 config.py:73-100 逐项照抄） */
export const DEFAULT_PRIORITY: Record<PriorityKind, number[]> = {
  video: [127, 126, 125, 122, 120, 116, 112, 100, 80, 64, 32, 16],
  audio: [30251, 30250, 30280, 30232, 30216],
  codec: [7, 12, 13],
};

/** 设置页里三张子行的标题（桌面版 PrioritySettingCard 的三行） */
export const PRIORITY_TITLE: Record<PriorityKind, string> = {
  video: "画质优先级",
  audio: "音质优先级",
  codec: "编码优先级",
};

/** 取某项在优先级列表里的显示名；未知 id 退回 "编号 N"，不假装认识。
 *  ⚠️ 表里存的是**简中原文**（也是 i18n 字典的键），在这里翻译 —— 表是模块级常量，
 *  若在建表时就 tr() 只会算一次，切语言不会变。 */
export function priorityLabel(kind: PriorityKind, id: number): string {
  return tr(PRIORITY_LABELS[kind][id] ?? `编号 ${id}`);
}

/** kind → config.download 里的字段名（写回配置时用） */
export const PRIORITY_KEY: Record<PriorityKind, "videoQualityPriority" | "audioQualityPriority" | "videoCodecPriority"> = {
  video: "videoQualityPriority",
  audio: "audioQualityPriority",
  codec: "videoCodecPriority",
};
