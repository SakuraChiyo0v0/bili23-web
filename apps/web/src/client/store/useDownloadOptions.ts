import { create } from "zustand";
import type { DownloadOptions, MediaItem, MediaOptionSummary } from "../services/types";
import { useSettingsStore as useSettingsStoreRef } from "./useSettingsStore";

/** 附加文件格式（对齐引擎 extras/types.ts） */
export type DanmakuFormat = "xml" | "ass" | "json";
export type SubtitleFormat = "srt" | "lrc" | "txt" | "ass" | "json";
export type CoverFormat = "jpg" | "png" | "avif" | "webp";
export type MetadataFormat = "nfo" | "json";

/** 弹幕/字幕样式（对齐引擎，宽松对象以兼容设置页 StyleEditor 值） */
export interface StyleValue {
  font?: { name: string; size: number; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean };
  border?: { border: number; shadow: number };
  advanced?: { displayArea: number; opacity: number; scrollDuration: number; staticDuration: number; minimumGap: number };
  color?: { primary: string; secondary: string; border: string; shadow: string };
  margin?: { left: number; right: number; vertical: number };
  resolution?: { width: number; height: number };
  alignment?: number;
}

/** 字幕语言选择（对齐引擎 SubtitleLanguageSelection） */
export interface SubtitleLanguage {
  downloadSpecified: boolean;
  specifiedLanguages: string[];
}

/** 下载选项表单（页签 2 附加内容为结构化对象，非扁平开关） */
export interface ExtraOptionState {
  video: boolean;
  audio: boolean;
  merge: boolean;
  keep: boolean;
  keepType: "both" | "video" | "audio";
  danmaku: { enabled: boolean; format: DanmakuFormat; embed: boolean; deleteAfterEmbed: boolean; style?: StyleValue };
  subtitle: { enabled: boolean; format: SubtitleFormat; language: SubtitleLanguage; embed: boolean; deleteAfterEmbed: boolean; style?: StyleValue };
  cover: { enabled: boolean; format: CoverFormat; attach: boolean; deleteAfterAttach: boolean };
  chapter: { embed: boolean };
  metadata: { enabled: boolean; format: MetadataFormat };
}

/** 将下载选项表单转换为后端识别的 extras 快照 */
export function formToExtras(form: ExtraOptionState): DownloadOptions["extras"] {
  return {
    danmaku: {
      enabled: form.danmaku.enabled,
      format: form.danmaku.format,
      style: form.danmaku.style,
      embed: form.danmaku.embed,
      deleteAfterEmbed: form.danmaku.deleteAfterEmbed,
    },
    subtitle: {
      enabled: form.subtitle.enabled,
      format: form.subtitle.format,
      language: form.subtitle.language,
      style: form.subtitle.style,
      embed: form.subtitle.embed,
      deleteAfterEmbed: form.subtitle.deleteAfterEmbed,
    },
    cover: {
      enabled: form.cover.enabled,
      format: form.cover.format,
      attach: form.cover.attach,
      deleteAfterAttach: form.cover.deleteAfterAttach,
    },
    chapter: { embed: form.chapter.embed },
    metadata: { enabled: form.metadata.enabled, format: form.metadata.format },
  };
}

interface DownloadOptionsState {
  open: boolean;
  /** 当前批量下载的条目（用于逐项取 mediaOptions） */
  items: MediaItem[];
  /** 当前编辑的媒体预览（单条目；多条目时用首个聚合） */
  media?: MediaOptionSummary;
  mediaLoading: boolean;
  mediaError?: string;
  /** 表单 */
  form: ExtraOptionState;
  videoQualityId: number;
  audioQualityId: number;
  codecId: number;
  /** 输出容器（MP4/MKV），默认取全局设置 */
  container: "mp4" | "mkv";
  /** 组装后的 DownloadOptions（点确认时写入） */
  resolved: DownloadOptions;
  openDialog: (items: MediaItem[]) => void;
  close: () => void;
  setMedia: (media: MediaOptionSummary) => void;
  setMediaLoading: (v: boolean) => void;
  setMediaError: (e?: string) => void;
  patchForm: (p: Partial<ExtraOptionState>) => void;
  setQuality: (v: number) => void;
  setAudio: (v: number) => void;
  setCodec: (v: number) => void;
  setContainer: (v: "mp4" | "mkv") => void;
  setResolved: (o: DownloadOptions) => void;
  reset: () => void;
}

/** 默认附加内容选项（与引擎 DEFAULT_EXTRAS_OPTIONS 保持一致） */
export const DEFAULT_EXTRAS_FORM = {
  danmaku: { enabled: false, format: "ass" as DanmakuFormat, embed: false, deleteAfterEmbed: false, style: undefined as StyleValue | undefined },
  subtitle: {
    enabled: false, format: "ass" as SubtitleFormat,
    language: { downloadSpecified: false, specifiedLanguages: [] as string[] },
    embed: false, deleteAfterEmbed: false, style: undefined as StyleValue | undefined,
  },
  cover: { enabled: false, format: "jpg" as CoverFormat, attach: false, deleteAfterAttach: false },
  chapter: { embed: false },
  metadata: { enabled: false, format: "nfo" as MetadataFormat },
};

export function defaultForm(additional: Record<string, unknown> | undefined): ExtraOptionState {
  const a = (additional ?? {}) as Record<string, any>;
  const danmaku = a.danmaku as Partial<ExtraOptionState["danmaku"]> | undefined;
  const subtitle = a.subtitle as Partial<ExtraOptionState["subtitle"]> | undefined;
  const cover = a.cover as Partial<ExtraOptionState["cover"]> | undefined;
  const chapter = a.chapter as Partial<ExtraOptionState["chapter"]> | undefined;
  const metadata = a.metadata as Partial<ExtraOptionState["metadata"]> | undefined;
  return {
    video: true, audio: true, merge: true, keep: false, keepType: "both",
    danmaku: {
      enabled: danmaku?.enabled ?? false,
      format: (danmaku?.format as DanmakuFormat) ?? "ass",
      embed: danmaku?.embed ?? false,
      deleteAfterEmbed: danmaku?.deleteAfterEmbed ?? false,
      style: danmaku?.style,
    },
    subtitle: {
      enabled: subtitle?.enabled ?? false,
      format: (subtitle?.format as SubtitleFormat) ?? "ass",
      language: subtitle?.language ?? { downloadSpecified: false, specifiedLanguages: [] },
      embed: subtitle?.embed ?? false,
      deleteAfterEmbed: subtitle?.deleteAfterEmbed ?? false,
      style: subtitle?.style,
    },
    cover: {
      enabled: cover?.enabled ?? false,
      format: (cover?.format as CoverFormat) ?? "jpg",
      attach: cover?.attach ?? false,
      deleteAfterAttach: cover?.deleteAfterAttach ?? false,
    },
    chapter: { embed: chapter?.embed ?? false },
    metadata: { enabled: metadata?.enabled ?? false, format: (metadata?.format as MetadataFormat) ?? "nfo" },
  };
}

const DEFAULT_FORM: ExtraOptionState = { video: true, audio: true, merge: true, keep: false, keepType: "both", ...DEFAULT_EXTRAS_FORM };

export const useDownloadOptions = create<DownloadOptionsState>((set) => ({
  open: false,
  items: [],
  media: undefined,
  mediaLoading: false,
  mediaError: undefined,
  form: { ...DEFAULT_FORM },
  videoQualityId: 0,
  audioQualityId: 0,
  codecId: 0,
  container: "mp4",
  resolved: {},
  openDialog: (items) => {
    // 打开时用全局设置作为初始值：容器取 download.defaultContainer，附加内容取 additional 默认
    let container: "mp4" | "mkv" = "mp4";
    let additional: Record<string, unknown> | undefined;
    try {
      const cfg = useSettingsStoreRef.getState().config;
      if (cfg?.download?.defaultContainer === "mkv") container = "mkv";
      additional = cfg?.additional;
    } catch {
      // store 未挂载时保持默认
    }
    set({ open: true, items, media: undefined, mediaLoading: true, mediaError: undefined, form: defaultForm(additional), container });
  },
  close: () => set({ open: false }),
  setMedia: (media) => set({ media, mediaLoading: false }),
  setMediaLoading: (v) => set({ mediaLoading: v }),
  setMediaError: (e) => set({ mediaError: e, mediaLoading: false }),
  patchForm: (p) => set((s) => ({ form: { ...s.form, ...p } })),
  setQuality: (v) => set({ videoQualityId: v }),
  setAudio: (v) => set({ audioQualityId: v }),
  setCodec: (v) => set({ codecId: v }),
  setContainer: (v) => set({ container: v }),
  setResolved: (o) => set({ resolved: o }),
  reset: () => set({ form: { ...DEFAULT_FORM }, videoQualityId: 0, audioQualityId: 0, codecId: 0, container: "mp4", resolved: {} }),
}));