import { useCallback, useState } from "react";
import { loadJSON, saveJSON } from "./storage";

export type SortField = "created" | "title" | "progress" | "size" | "status";
export interface DownloadListPrefs { sort: SortField; desc: boolean; notifyFinished: boolean }
const KEY = "ui.downloadList";
export const DEFAULT_DL_PREFS: DownloadListPrefs = { sort: "created", desc: true, notifyFinished: true };

export function loadDownloadListPrefs(): DownloadListPrefs {
  return { ...DEFAULT_DL_PREFS, ...loadJSON<Partial<DownloadListPrefs>>(KEY, {}) };
}
export function useDownloadListPrefs(): [DownloadListPrefs, (p: Partial<DownloadListPrefs>) => void] {
  const [prefs, setPrefs] = useState<DownloadListPrefs>(loadDownloadListPrefs);
  const update = useCallback((p: Partial<DownloadListPrefs>) => {
    setPrefs((prev) => { const next = { ...prev, ...p }; saveJSON(KEY, next); return next; });
  }, []);
  return [prefs, update];
}