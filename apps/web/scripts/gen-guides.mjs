#!/usr/bin/env node
/**
 * 从 docs/parity/原版界面文案-按文件.md 抽取原版「说明」正文，生成
 * apps/web/src/client/lib/guides.ts。
 *
 * 为什么用脚本而不是手抄：这些文案是整段多行中文，手抄极易错字漏句；
 * 而且原版文案改动后，我们这边重跑一次就能同步。
 *
 * 用法（仓库根目录）：node apps/web/scripts/gen-guides.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const docPath = join(repoRoot, "docs", "parity", "原版界面文案-按文件.md");
const outPath = join(repoRoot, "apps", "web", "src", "client", "lib", "guides.ts");

/** 需要生成的说明常量（顺序即输出顺序） */
const WANTED = [
  "MEDIA_INFO_GUIDE",
  "MEDIA_OPTIONS_GUIDE",
  "NAMING_RULE_GUIDE",
  "PRIORITY_GUIDE",
  "NUMBERING_GUIDE",
  "PREALLOCATE_GUIDE",
  "DUPLICATE_DOWNLOAD_GUIDE",
];

const lines = readFileSync(docPath, "utf8").split(/\r?\n/);
/** @type {Map<string, string>} */
const found = new Map();

for (const line of lines) {
  if (!line.startsWith("|")) continue;
  const cells = line.split("|").map((c) => c.trim());
  // 表格行形如 | 405 | NUMBERING_GUIDE | EN | ZH | 备注 |
  // split 后首尾各有一个空串，所以 cells[2] 是常量名、cells[4] 是简中译文。
  const name = cells[2];
  if (!name || !name.endsWith("_GUIDE")) continue;
  const zh = cells[4];
  if (!zh) continue;
  // 同一常量可能有两行（旧文案已被标记「已废弃」）：以未废弃的那一行为准
  if (line.includes("已废弃")) continue;
  if (found.has(name)) {
    console.warn(`[warn] ${name} 出现多行且都未标记废弃，采用后出现的一行`);
  }
  found.set(name, zh);
}

const missing = WANTED.filter((n) => !found.has(n));
if (missing.length > 0) {
  console.error(`[err] 以下常量在 ${relative(repoRoot, docPath)} 中未找到：${missing.join(", ")}`);
  process.exit(1);
}

const entries = WANTED.map((name) => {
  const raw = found.get(name);
  // 文档里存的就是 Python repr 转义后的文本：换行是字面量 \n（反斜杠 + n）。
  // TS 里 \n 同样是转义序列，所以原样保留即可；只需转义 ASCII 双引号。
  if (raw.includes("\\") && !/\\n/.test(raw)) {
    console.warn(`[warn] ${name} 含反斜杠但不含 \\n，请人工确认转义：${raw.slice(0, 60)}`);
  }
  const escaped = raw.replace(/"/g, '\\"');
  return `export const ${name} = "${escaped}";`;
});

const header = `/**
 * 原版「说明」正文 —— 由 apps/web/scripts/gen-guides.mjs 从
 * docs/parity/原版界面文案-按文件.md 抽取（简中译文），请勿手工编辑。
 *
 * 文中的 \\n 是 TS 字符串转义（渲染时才是真换行）；正文里的 ASCII 双引号已转义。
 * 原版文案有改动时，重跑：node apps/web/scripts/gen-guides.mjs
 */
`;

writeFileSync(outPath, header + "\n" + entries.join("\n\n") + "\n", "utf8");
console.log(`已生成 ${relative(repoRoot, outPath)}（${entries.length} 条）`);
for (const name of WANTED) console.log(`  - ${name} (${found.get(name).length} 字符)`);
