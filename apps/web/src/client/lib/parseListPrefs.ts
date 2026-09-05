import { useCallback, useState } from "react";
import { loadJSON, saveJSON } from "../lib/storage";

export interface ParseListPrefs {
  /** 显示标签/时长/时间等副信息列（关闭后仅“勾选+标题”两列） */
  showMeta: boolean;
  /** 交替行色 */
  zebraRows: boolean;
}
export const DEFAULT_PARSE_LIST_PREFS: ParseListPrefs = { showMeta: true, zebraRows: true };
const KEY = "ui.parseList";

export function loadParseListPrefs(): ParseListPrefs {
  const stored = loadJSON<Partial<ParseListPrefs>>(KEY, {});
  return { ...DEFAULT_PARSE_LIST_PREFS, ...stored };
}

export function useParseListPrefs(): [ParseListPrefs, (patch: Partial<ParseListPrefs>) => void] {
  const [prefs, setPrefs] = useState<ParseListPrefs>(loadParseListPrefs);
  const update = useCallback((patch: Partial<ParseListPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      saveJSON(KEY, next);
      return next;
    });
  }, []);
  return [prefs, update];
}