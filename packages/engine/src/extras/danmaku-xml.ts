import type { DanmakuEntry } from "./types.js";

/**
 * 弹幕 XML：解析（B 站标准 XML）与生成（对齐桌面 file/danmaku_xml.py 模板）。
 * - 生成模板与上游逐字一致（chatid/maxlimit=1500/条目缩进 4 空格）；
 * - stime 在条目中以毫秒存储，渲染为秒并保留 5 位小数（对齐 `f"{ms/1000:.5f}"`）。
 */
const XML_BASE = `<?xml version="1.0" encoding="UTF-8"?>
<i>
    <chatserver>chat.bilibili.com</chatserver>
    <chatid>{cid}</chatid>
    <mission>0</mission>
    <maxlimit>1500</maxlimit>
    <state>0</state>
    <real_name>0</real_name>
    <source>k-v</source>
{comments}
</i>`;

/** 移除控制字符并转义 XML 特殊字符（对齐上游 _filter_invalid_characters） */
export function escapeXmlText(text: string): string {
  return text
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** 解析 XML 实体（仅常用预定义实体） */
function unescapeXmlText(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

const D_TAG = /<d\s+p="([^"]*)"[^>]*>([\s\S]*?)<\/d>/g;

/**
 * 解析 B 站标准弹幕 XML 为归一化条目。
 * p 属性：时间(秒),mode,size,color,date,pool,uhash,dmid[,weight]。
 * 与桌面相同过滤无效条目（无 stime 或无 text 的丢弃）；stime 统一为毫秒。
 */
export function parseDanmakuXml(xml: string): DanmakuEntry[] {
  const entries: DanmakuEntry[] = [];
  let match: RegExpExecArray | null;
  D_TAG.lastIndex = 0;
  while ((match = D_TAG.exec(xml)) !== null) {
    const p = (match[1] ?? "").split(",");
    const text = unescapeXmlText(match[2] ?? "");
    const stimeSec = Number(p[0]);
    const stimeMs = Math.round(stimeSec * 1000);
    const mode = Number(p[1]);
    if (!Number.isFinite(stimeSec) || stimeMs <= 0 || !text) continue;

    const entry: DanmakuEntry = {
      stime: stimeMs,
      mode: Number.isFinite(mode) ? mode : 1,
      size: Number.isFinite(Number(p[2])) ? Number(p[2]) : 25,
      color: Number.isFinite(Number(p[3])) ? Number(p[3]) : 16777215,
      date: Number.isFinite(Number(p[4])) ? Number(p[4]) : 0,
      uhash: p[6] ?? "",
      dmid: p[7] ?? "",
      text,
    };
    const weight = Number(p[8]);
    if (Number.isFinite(weight) && weight > 0) entry.weight = weight;
    entries.push(entry);
  }
  return entries;
}

/**
 * 渲染弹幕 XML（对齐桌面 DanmakuXML.generate）。
 * @param entries 归一化条目（stime 毫秒）
 * @param cid 视频分P cid（chatid）
 */
export function renderDanmakuXml(entries: DanmakuEntry[], cid: number): string {
  const comments: string[] = [];
  for (const entry of entries) {
    const line =
      `<d p="${(entry.stime / 1000).toFixed(5)},${entry.mode ?? 1},${entry.size ?? 25},` +
      `${entry.color ?? 16777215},${entry.date ?? 0},0,${entry.uhash ?? 0},${entry.dmid ?? 0}">` +
      `${escapeXmlText(entry.text ?? "")}</d>`;
    comments.push(`    ${line}`);
  }
  return XML_BASE.replace("{cid}", String(cid)).replace("{comments}", comments.join("\n"));
}

/** 生成 XML 文本（renderDanmakuXml 别名，保持命名对称） */
export function danmakuToXml(entries: DanmakuEntry[], cid: number): string {
  return renderDanmakuXml(entries, cid);
}
