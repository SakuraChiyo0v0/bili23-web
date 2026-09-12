import { useCallback, useState } from "react";
import { loadJSON, saveJSON } from "./storage.js";

/**
 * 解析列表的列配置 —— 对齐原版 `config.parse_list_column`（`config.py:30-56`）。
 *
 * 原版是一个**数组**（不是几个布尔），每项 `{ attr_key, width, show }`，
 * 顺序就是显示顺序；「序号」列锁定在第一列、不可隐藏、不可拖动（`parse_list.py:55-56`）。
 * 默认值与原版逐项一致：number 160 / title 350 / badge 90 / duration 90 / dyn_time 130。
 */

export type ColumnKey = "number" | "title" | "badge" | "duration" | "dyn_time";

export interface ColumnPref {
  key: ColumnKey;
  width: number;
  show: boolean;
}

/** 列名（原版 `Translator.COLUMN_NAME` 的简中译文；dyn_time 的标题是**动态**的，见 dynTimeLabel） */
export const COLUMN_LABEL: Record<ColumnKey, string> = {
  number: "序号",
  title: "标题",
  badge: "备注",
  duration: "时长",
  dyn_time: "发布时间 / 收藏时间 / 上次观看时间",
};

export const DEFAULT_COLUMNS: ColumnPref[] = [
  { key: "number", width: 160, show: true },
  { key: "title", width: 350, show: true },
  { key: "badge", width: 90, show: true },
  { key: "duration", width: 90, show: true },
  { key: "dyn_time", width: 130, show: true },
];

/** 第一列（序号）锁定：始终可见、始终排在最前 */
export const LOCKED_COLUMN: ColumnKey = "number";

export interface ParseListPrefs {
  columns: ColumnPref[];
  /** 交替行色（原版 parse_list_alternate_row_color） */
  zebraRows: boolean;
  /** 显示行上的「⋯」（原版「悬浮命令栏」parse_list_show_floating_command_bar，默认开） */
  floatingBar: boolean;
}
export const DEFAULT_PARSE_LIST_PREFS: ParseListPrefs = { columns: DEFAULT_COLUMNS, zebraRows: true, floatingBar: true };

const KEY = "ui.parseList";
const KEYS = new Set<string>(DEFAULT_COLUMNS.map((c) => c.key));

/**
 * 归一化：只保留已知列、补齐缺失列、强制序号列可见且在最前。
 * 这样旧版本存下的 `{showMeta:true}` 或残缺数据不会把界面搞坏（缺列就用默认宽度补上）。
 */
export function normalizeColumns(raw: unknown): ColumnPref[] {
  const arr = Array.isArray(raw) ? (raw as Array<Partial<ColumnPref>>) : [];
  const seen = new Set<ColumnKey>();
  const out: ColumnPref[] = [];
  for (const item of arr) {
    const key = item?.key as ColumnKey | undefined;
    if (!key || !KEYS.has(key) || seen.has(key)) continue;
    seen.add(key);
    const def = DEFAULT_COLUMNS.find((c) => c.key === key)!;
    const width = typeof item.width === "number" && item.width >= 60 ? Math.round(item.width) : def.width;
    out.push({ key, width, show: key === LOCKED_COLUMN ? true : item.show !== false });
  }
  // 补齐缺失列（按默认顺序追加）
  for (const def of DEFAULT_COLUMNS) if (!seen.has(def.key)) out.push({ ...def });
  // 序号列锁到最前
  const locked = out.findIndex((c) => c.key === LOCKED_COLUMN);
  if (locked > 0) out.unshift(out.splice(locked, 1)[0]!);
  return out;
}

export function loadParseListPrefs(): ParseListPrefs {
  const stored = loadJSON<Partial<ParseListPrefs>>(KEY, {});
  return {
    columns: normalizeColumns(stored.columns),
    zebraRows: stored.zebraRows !== false,
    floatingBar: stored.floatingBar !== false,
  };
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
