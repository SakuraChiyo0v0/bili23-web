import type { DanmakuEntry } from "./types.js";

/**
 * 弹幕 → JSON（对齐桌面 danmaku.py _to_json：json_dumps(dict_list, indent=2)）。
 * 输出的是条目数组（字段名与桌面 protobuf→dict 一致：stime/mode/size/color/date/uhash/dmid/text）。
 */

export function danmakuToJson(entries: DanmakuEntry[]): string {
  return JSON.stringify(entries, null, 2);
}
