import { t as tr } from "./i18n.js";
/**
 * 「批量选择」的行号解析（原版 `dialog/misc/batch_select.py:39-81`）。
 *
 * 三条失败文案逐字对齐原版：
 *   空 → 请输入行号 ｜ 范围不合法（非正整数 / 起点大于终点）→ 行号范围格式错误 ｜ 单个号不合法 → 行号格式错误
 *
 * **原版不校验上界**：比序号列大的号照样交给列表，命中不了就是没勾到。
 * 这里保持一致（不报错），由调用方决定要不要提示"有 N 个号超出范围"。
 *
 * 除原版的 `1,3,5-10` 外，额外接受 `1..10`（我们自己的写法）与中文逗号/分号分隔。
 */
export type BatchSelectParse =
  | { ok: true; numbers: number[] }
  // message 是**已翻译**的文案（三条之一），所以这里只能是 string，不能是字面量联合
  | { ok: false; message: string };

export function parseLineNumbers(text: string): BatchSelectParse {
  const raw = text.trim();
  if (!raw) return { ok: false, message: tr("请输入行号") };

  const out: number[] = [];
  for (const part of raw.split(/[,，;；\s]+/).filter(Boolean)) {
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(part) ?? /^(\d+)\.\.(\d+)$/.exec(part);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (start <= 0 || end <= 0 || start > end) return { ok: false, message: tr("行号范围格式错误") };
      for (let i = start; i <= end; i += 1) out.push(i);
      continue;
    }
    if (!/^\d+$/.test(part) || Number(part) <= 0) return { ok: false, message: tr("行号格式错误") };
    out.push(Number(part));
  }
  if (out.length === 0) return { ok: false, message: tr("行号格式错误") };
  return { ok: true, numbers: [...new Set(out)] };
}
