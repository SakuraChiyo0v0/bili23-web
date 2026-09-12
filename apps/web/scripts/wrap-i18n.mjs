#!/usr/bin/env node
/**
 * 把界面上的**静态文案**机械地包上 `tr()`（i18n 接线第一步）。
 *
 * 只处理两种"绝对安全"的形态：
 *   ① JSX 文本节点：`>下载选项<` → `>{tr("下载选项")}<`
 *   ② 三个属性值：`title="搜索"` / `placeholder="请输入关键词"` / `aria-label="关闭"` → `attr={tr("…")}`
 *
 * 刻意**不碰**的东西（都要人工）：
 *   - 含 `{}` 或空白/换行的文本（`{count} 项`、跨行 JSX 文本）——包进字符串会改变空白语义
 *   - JS 里的字符串字面量（`toast("…")`、常量表）——嵌套括号与模板串人工更稳
 *
 * 为什么用 `tr` 而不是 `t`：`t` 在本仓库里是极常见的局部变量名（`tasks.map((t) => …)`、
 * `useTasksStore` 的 `(t)` 等 **13 个文件**），导入成 `t` 会被遮蔽成任务对象 / store 值。
 * `tr` 全仓无占用，而且原版是 Qt 程序（`self.tr(...)` 就是它的翻译函数），名字也对得上。
 *
 * 用法：
 *   node apps/web/scripts/wrap-i18n.mjs --dry     # 只报告会改多少处
 *   node apps/web/scripts/wrap-i18n.mjs --write   # 真写
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const clientDir = join(repoRoot, "apps", "web", "src", "client");
const WRITE = process.argv.includes("--write");

/** JSX **文本节点**：只认纯中文文案，且**不含任何空白**（文本节点里空白会被 JSX 折叠，
 *  包进字符串会改变渲染结果）——中文 + 常见中英标点/数字/花括号，长度 ≤ 40 */
const TEXT = /^[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef0-9A-Za-z{}·—…%]+$/;
/** **属性值**（title/placeholder/aria-label/label/desc）：字符串里空白是安全的，
 *  所以放宽到"含中文即可"，允许空格、拉丁字母、花括号（`配置 {number} 变量的格式`）*/
const TEXT_ATTR = /^[^"\n]{1,120}$/;
const hasHan = /[\u4e00-\u9fa5]/;

const GENERATED = /(i18nDict\.ts|guides\.ts)$/;

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/\.tsx$/.test(name)) acc.push(full);
  }
  return acc;
}

/**
 * 该文件该用哪种相对路径引 i18n（通用算法：算到 src/client/lib/i18n 的相对路径）。
 * ⚠️ `lib/` 下的文件要带 `.js` 后缀：它们会被**服务端 tsconfig**（node16 解析）编译
 * （单测 import 了它们），那边要求显式扩展名。
 */
function i18nImport(from) {
  const rel = relative(dirname(from), join(clientDir, "lib", "i18n")).replace(/\\/g, "/");
  const withDot = rel.startsWith(".") ? rel : `./${rel}`;
  return withDot.startsWith("./") && !withDot.includes("/", 2) ? `${withDot}.js` : withDot;
}

let totalText = 0;
let totalAttr = 0;
let totalCall = 0;
let totalTern = 0;
let totalOpt = 0;
const touched = [];

for (const file of walk(clientDir)) {
  if (GENERATED.test(file)) continue;
  let src = readFileSync(file, "utf8");
  const orig = src;
  let nText = 0;
  let nAttr = 0;
  let nCall = 0;
  let nTern = 0;
  let nOpt = 0;

  // ① JSX 文本节点
  src = src.replace(/>([^<>{}]+)</g, (all, inner) => {
    const t = inner.trim();
    if (t !== inner) return all;          // 前后有空格 → 交给人工（空白语义）
    if (!TEXT.test(t) || !hasHan.test(t)) return all;
    nText += 1;
    return `>{tr(${JSON.stringify(t)})}<`;
  });

  // ② 属性值（空白/拉丁/花括号都允许）
  src = src.replace(/\b(title|placeholder|aria-label|label|desc)="([^"]+)"/g, (all, attr, val) => {
    if (!TEXT_ATTR.test(val) || !hasHan.test(val)) return all;
    nAttr += 1;
    return `${attr}={tr(${JSON.stringify(val)})}`;
  });

  // ③ toast("…") / toast("…", "warn") —— 单层、无插值的调用才动
  src = src.replace(/\btoast\((["'])((?:(?!\1)[^\\\n])*?)\1(\)|,)/g, (all, q, val, tail) => {
    if (!hasHan.test(val) || val.includes("${")) return all;
    nCall += 1;
    return `toast(tr(${q}${val}${q})${tail}`;
  });

  // ⑤ Seg 的选项数组：`options={[["auto","自动识别"],…]}` → 只包**第二个元素**（显示文案）
  src = src.replace(/options=\{\[([\s\S]*?)\]\}/g, (all, body) => {
    const wrapped = body.replace(/\[\s*(["'])((?:(?!\1)[^\\\n])*?)\1\s*,\s*(["'])((?:(?!\3)[^\\\n])*?)\3\s*\]/g,
      (pair, q1, v1, q2, v2) => {
        if (!hasHan.test(v2) || v2.includes("${")) return pair;
        nOpt += 1;
        return `[${q1}${v1}${q1}, tr(${q2}${v2}${q2})]`;
      });
    return `options={[${wrapped}]}`;
  });

  src = src.replace(/\?\s*(["'])((?:(?!\1)[^\\\n])*?)\1\s*:\s*(["'])((?:(?!\3)[^\\\n])*?)\3/g, (all, q1, a, q2, b) => {
    const wa = hasHan.test(a) && !a.includes("${");
    const wb = hasHan.test(b) && !b.includes("${");
    if (!wa && !wb) return all;
    nTern += 1;
    return `? ${wa ? `tr(${q1}${a}${q1})` : `${q1}${a}${q1}`} : ${wb ? `tr(${q2}${b}${q2})` : `${q2}${b}${q2}`}`;
  });

  if (src === orig) continue;

  // 补 import（放在最后一条 import 之后；没有 import 就放最前）
  // ⚠️ 判重必须看"是否已经从 i18n 模块导入过" —— 只比对整行会重复插入
  //   （App.tsx 的 import 里还带着 resolveLang/setCurrentLang，整行不相等 → 又插一行 → Duplicate identifier 'tr'）
  const imp = `import { t as tr } from "${i18nImport(file)}";`;
  const alreadyImports = new RegExp(`from\\s+"[^"]*lib/i18n(?:\\.js)?"`).test(src) || /from\s+"\.\/i18n(?:\.js)?"/.test(src);
  if (!src.includes(imp) && !alreadyImports) {
    const lines = src.split("\n");
    let lastImport = -1;
    for (let i = 0; i < lines.length; i += 1) {
      if (/^\s*import\s/.test(lines[i])) lastImport = i;
      if (lastImport >= 0 && i > lastImport + 20) break;
    }
    if (lastImport >= 0) lines.splice(lastImport + 1, 0, imp);
    else lines.unshift(imp);
    src = lines.join("\n");
  }

  totalText += nText;
  totalAttr += nAttr;
  totalCall += nCall;
  totalTern += nTern;
  totalOpt += nOpt;
  touched.push([relative(repoRoot, file).replace(/\\/g, "/"), nText, nAttr]);
  if (WRITE) writeFileSync(file, src, "utf8");
}

console.log(`${WRITE ? "已写入" : "预演（未写）"}：JSX 文本 ${totalText} + 属性 ${totalAttr} + toast ${totalCall} + 三元 ${totalTern} + 选项 ${totalOpt}，涉及 ${touched.length} 个文件`);
for (const [f, a, b, c2, d] of touched.sort((x, y) => (y[1] + y[2] + y[3] + y[4]) - (x[1] + x[2] + x[3] + x[4]))) {
  console.log(`  ${String(a).padStart(3)}文本 ${String(b).padStart(2)}属性 ${String(c2).padStart(3)}toast ${String(d).padStart(3)}三元  ${f}`);
}
