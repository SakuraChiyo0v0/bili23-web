import { create } from "zustand";
import type { DownloadOptions, MediaItem, MediaOptionSummary } from "../services/types";
import { useSettingsStore as useSettingsStoreRef } from "./useSettingsStore";

export interface ExtraOptionState {
  video: boolean;
  audio: boolean;
  merge: boolean;
  keep: boolean;
  keepType: "both" | "video" | "audio";
  danmaku: boolean;
  subtitle: boolean;
  cover: boolean;
  chapter: boolean;
  metadata: boolean;
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

const DEFAULT_FORM: ExtraOptionState = {
  video: true, audio: true, merge: true, keep: false, keepType: "both",
  danmaku: false, subtitle: false, cover: false, chapter: false, metadata: false,
};

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
    // 打开时用全局下载设置的默认容器；取不到时回退 MP4
    let container: "mp4" | "mkv" = "mp4";
    try {
      const cfg = useSettingsStoreRef.getState().config;
      if (cfg?.download?.defaultContainer === "mkv") container = "mkv";
    } catch {
      // store 未挂载时保持默认
    }
    set({ open: true, items, media: undefined, mediaLoading: true, mediaError: undefined, form: { ...DEFAULT_FORM }, container });
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