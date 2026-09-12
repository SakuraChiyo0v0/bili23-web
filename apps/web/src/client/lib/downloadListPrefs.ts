import { useCallback, useState } from "react";
import { loadJSON, saveJSON } from "./storage";

/**
 * 下载列表的排序偏好 —— 对齐原版：**两个页签各自存一套**
 * （`config.downloading_list_sort_by` / `completed_list_sort_by`，见 `download.py:38-48`）。
 *
 * 选项集合也按页签分派（原版 `download_list/top_widget.py:17-101`）：
 *   下载中：创建时间 / 标题名称 / 文件大小 / 下载进度      ← **没有「状态」**
 *   已完成：完成时间 / 标题名称 / 文件大小                ← **没有「进度」「状态」**
 */
export type SortField = "created" | "title" | "size" | "progress" | "completed";

export const DOWNLOADING_SORTS: Array<[SortField, string]> = [
  ["created", "创建时间"],
  ["title", "标题名称"],
  ["size", "文件大小"],
  ["progress", "下载进度"],
];
export const COMPLETED_SORTS: Array<[SortField, string]> = [
  ["completed", "完成时间"],
  ["title", "标题名称"],
  ["size", "文件大小"],
];

export interface TabSort { sort: SortField; desc: boolean }
export interface DownloadListPrefs {
  downloading: TabSort;
  completed: TabSort;
  notifyFinished: boolean;
}
const KEY = "ui.downloadList";
export const DEFAULT_DL_PREFS: DownloadListPrefs = {
  downloading: { sort: "created", desc: true },
  completed: { sort: "completed", desc: true },
  notifyFinished: true,
};

/** 归一化：把旧结构（单份 sort/desc）和脏数据都收敛成两份，并按页签校验选项合法 */
function normalize(raw: Partial<DownloadListPrefs> & { sort?: SortField; desc?: boolean }): DownloadListPrefs {
  const okFor = (tab: "downloading" | "completed", f: SortField | undefined): SortField => {
    const allowed = (tab === "downloading" ? DOWNLOADING_SORTS : COMPLETED_SORTS).map(([k]) => k);
    return f && allowed.includes(f) ? f : DEFAULT_DL_PREFS[tab].sort;
  };
  const legacy: TabSort | undefined = raw.sort ? { sort: raw.sort, desc: raw.desc !== false } : undefined;
  return {
    downloading: {
      sort: okFor("downloading", raw.downloading?.sort ?? legacy?.sort),
      desc: (raw.downloading ?? legacy)?.desc !== false,
    },
    completed: {
      sort: okFor("completed", raw.completed?.sort),
      desc: raw.completed?.desc !== false,
    },
    notifyFinished: raw.notifyFinished !== false,
  };
}

export function loadDownloadListPrefs(): DownloadListPrefs {
  return normalize(loadJSON<Partial<DownloadListPrefs>>(KEY, {}));
}
export function useDownloadListPrefs(): [DownloadListPrefs, (p: Partial<DownloadListPrefs>) => void] {
  const [prefs, setPrefs] = useState<DownloadListPrefs>(loadDownloadListPrefs);
  const update = useCallback((p: Partial<DownloadListPrefs>) => {
    setPrefs((prev) => { const next = normalize({ ...prev, ...p }); saveJSON(KEY, next); return next; });
  }, []);
  return [prefs, update];
}
