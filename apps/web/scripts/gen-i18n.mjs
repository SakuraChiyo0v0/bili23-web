#!/usr/bin/env node
/**
 * 从**原版仓库**的 Qt 翻译文件生成三语字典（en / zh-CN / zh-TW）。
 *
 * 为什么不用我们自己的对账文档：原版 `src/res/i18n/bili23.zh_CN.ts` 与 `bili23.zh_TW.ts`
 * 各有 904 条 `<message>`，同一条目的 `<source>` 就是英文原文（Qt 的源语言），
 * 于是 **一个文件对就能凑齐三语**，不需要任何翻译工作。
 *
 * 产出：`apps/web/src/client/lib/i18nDict.ts`
 *   - 键 = **简中译文**（我们现在界面上的文案就是从原版简中逐字抄的）
 *   - 值 = 英文（`<source>`）与繁中（zh_TW 的 `<translation>`）
 *
 * 另附**覆盖率报告**：扫我们客户端源码里的中文字面量，看有多少能在这本字典里查到 ——
 * 这个数字决定"要不要真做 i18n"以及"还要人工处理多少条"。
 *
 * 用法（仓库根目录）：node apps/web/scripts/gen-i18n.mjs
 * 环境变量：
 *   BILI23_REF_DIR  原版仓库根目录（默认取**仓库同级**的 Bili23-Downloader；不写死本机路径）
 *   SKIP_COVERAGE=1 跳过覆盖率扫描（只生成字典）
 */
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const refDir = process.env.BILI23_REF_DIR ?? join(repoRoot, "..", "Bili23-Downloader");
if (!existsSync(refDir)) {
  console.error(`找不到原版仓库：${refDir}\n请用环境变量 BILI23_REF_DIR 指定 Bili23-Downloader 的根目录`);
  process.exit(1);
}
const outPath = join(repoRoot, "apps", "web", "src", "client", "lib", "i18nDict.ts");

/** Qt .ts 里出现过的 XML 实体（只这几个，工具确认过） */
function decodeEntities(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * 解析 Qt .ts：返回 Map<`${context}\u0000${source}`, {en, zh}>
 * （context + source 才算唯一 —— 同一条英文在不同 context 下可能有不同译文）
 *
 * ⚠️ 第一版按行扫描 + 状态机，结果把 `</message>` 尾巴也吃进了字符串（覆盖率 0% 才发现）。
 * 现在改成"先切 context 块、再切 message 块"的正则匹配 —— 结构性解析比逐行状态机稳。
 */
function parseTs(file) {
  const text = readFileSync(file, "utf8");
  const out = new Map();
  for (const ctx of text.matchAll(/<context>\s*<name>([\s\S]*?)<\/name>([\s\S]*?)<\/context>/g)) {
    const context = ctx[1].trim();
    const body = ctx[2];
    for (const msg of body.matchAll(/<message>([\s\S]*?)<\/message>/g)) {
      const blk = msg[1];
      const src = /<source>([\s\S]*?)<\/source>/.exec(blk);
      const tr = /<translation([^>]*)>([\s\S]*?)<\/translation>/.exec(blk);
      if (!src || !tr) continue;
      if (/type="vanished"/.test(tr[1])) continue;
      const en = decodeEntities(src[1]).trim();
      const zh = decodeEntities(tr[2]).trim();
      if (!en || !zh) continue;
      out.set(`${context}\u0000${en}`, { en, zh });
    }
  }
  return out;
}

const zhCnPath = join(refDir, "src", "res", "i18n", "bili23.zh_CN.ts");
const zhTwPath = join(refDir, "src", "res", "i18n", "bili23.zh_TW.ts");
for (const p of [zhCnPath, zhTwPath]) {
  try { statSync(p); } catch { console.error(`[err] 找不到原版翻译文件：${p}`); process.exit(1); }
}

const cn = parseTs(zhCnPath);
const tw = parseTs(zhTwPath);

/** zh-CN 文本 → { en, tw }；同一简中文案对应多条时保留出现次数最多的那条英文 */
const map = new Map();
let conflicts = 0;
for (const [key, { en, zh }] of cn) {
  const twEntry = tw.get(key);
  const prev = map.get(zh);
  if (prev) {
    conflicts += 1;
    // 同名键冲突：英文取更短的那条（更可能是通用标签而非整句）
    if (en.length < prev.en.length) map.set(zh, { en, tw: twEntry?.zh ?? "" });
    continue;
  }
  map.set(zh, { en, tw: twEntry?.zh ?? "" });
}

const entries = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], "zh"));
const header = `/**
 * 三语字典（en / zh-TW）—— 由 apps/web/scripts/gen-i18n.mjs 从**原版仓库**的
 * Qt 翻译文件（src/res/i18n/bili23.zh_CN.ts + bili23.zh_TW.ts，各 904 条）生成，请勿手工编辑。
 *
 * 键 = **简中译文**（= 我们现在界面上的文案），值 = 英文原文 / 繁中译文。
 * 查不到就原样返回简中 —— 见 lib/i18n.ts 的 t()。
 *
 * 重新生成：node apps/web/scripts/gen-i18n.mjs
 */
`;
const body =
  `\n/** 简中 → 英文（原版 Qt 的 <source>，即原版"英文界面"用的就是这些） */\n` +
  `export const ZH_TO_EN: Record<string, string> = {\n` +
  entries.map(([zh, v]) => `  ${JSON.stringify(zh)}: ${JSON.stringify(v.en)},`).join("\n") +
  `\n};\n\n/** 简中 → 繁中（原版 zh_TW 的 <translation>） */\n` +
  `export const ZH_TO_TW: Record<string, string> = {\n` +
  entries.map(([zh, v]) => `  ${JSON.stringify(zh)}: ${JSON.stringify(v.tw)},`).join("\n") +
  `\n};\n`;

writeFileSync(outPath, header + body, "utf8");
const sizeKb = Math.round(statSync(outPath).size / 1024);
console.log(`已生成 ${relative(repoRoot, outPath)}：${entries.length} 条（zh→en / zh→tw），${sizeKb} KB`);
console.log(`  zh_CN 解析到 ${cn.size} 条、zh_TW 解析到 ${tw.size} 条；简中撞车 ${conflicts} 处（保留英文较短的那条）`);

// ---------- 覆盖率报告 ----------
if (process.env.SKIP_COVERAGE === "1") process.exit(0);

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (/\.(tsx?|ts)$/.test(name)) acc.push(full);
  }
  return acc;
}

const clientDir = join(repoRoot, "apps", "web", "src", "client");
/** 生成物不算"待翻译的界面文案"（否则字典自己会被算进来） */
const GENERATED = /(i18nDict\.ts|guides\.ts)$/;
const files = walk(clientDir).filter((f) => !GENERATED.test(f));
/**
 * 覆盖率只统计**明确的界面文案**，避免把代码片段/英文算进来：
 * - JSX 文本节点：`>中文<`
 * - 三个属性值：`title="中文"` / `placeholder="中文"` / `aria-label="中文"`
 * - 纯中文（+标点/数字/花括号）才算，长度 ≤ 80
 */
const UI_TEXT = /^[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef0-9{}%·—…()（）「」“”‘’\s]{1,80}$/;
const han = /[\u4e00-\u9fa5]/;
const labels = new Set();
/** 动态文案（含模板插值）单独统计：这些必须人工处理 */
const dynamic = new Set();
/** 每个文件的未命中数（判断"接哪个文件划算"） */
const missByFile = new Map();
for (const f of files) {
  const text = readFileSync(f, "utf8");
  const local = new Set();
  for (const m of text.matchAll(/>([^<>{}]*[\u4e00-\u9fa5][^<>{}]*)</g)) {
    const t = m[1].trim();
    if (UI_TEXT.test(t)) { labels.add(t); local.add(t); }
  }
  for (const m of text.matchAll(/\b(title|placeholder|aria-label)="([^"]*[\u4e00-\u9fa5][^"]*)"/g)) {
    const t = m[2].trim();
    if (UI_TEXT.test(t)) { labels.add(t); local.add(t); }
  }
  for (const m of text.matchAll(/(["'`])((?:(?!\1)[^\\\n]|\\.)*?)\1/g)) {
    const raw = m[2];
    if (raw.includes("${") && han.test(raw)) dynamic.add(raw.trim());
  }
  const missHere = [...local].filter((s) => !map.has(s)).length;
  if (missHere > 0) missByFile.set(relative(clientDir, f).replace(/\\/g, "/"), { miss: missHere, total: local.size });
}
const all = [...labels];
const hit = all.filter((s) => map.has(s));
const miss = all.filter((s) => !map.has(s)).sort((a, b) => b.length - a.length);
const pct = all.length ? Math.round((hit.length / all.length) * 100) : 0;
console.log(`\n覆盖率（只统计明确的界面文案：JSX 文本节点 + title/placeholder/aria-label）：`);
console.log(`  唯一文案 ${all.length} 条 → 字典命中 ${hit.length} 条 = ${pct}%`);
console.log(`  未命中 ${miss.length} 条，最长的 8 条：`);
for (const s of miss.slice(0, 8)) console.log(`    - ${s.replace(/\n/g, "\\n").slice(0, 56)}`);
console.log(`  另：含 \${} 插值的动态文案 ${dynamic.size} 条（必须人工改成参数化写法）`);
console.log(`  未命中最多的 10 个文件（miss/该文件文案数）：`);
for (const [f, v] of [...missByFile.entries()].sort((a, b) => b[1].miss - a[1].miss).slice(0, 10)) {
  console.log(`    ${String(v.miss).padStart(3)}/${String(v.total).padEnd(3)}  ${f}`);
}
