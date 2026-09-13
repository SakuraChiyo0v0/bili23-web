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

/**
 * **我们自己的词**的译文补充表。
 *
 * 原版没有这些词（都是 Web 侧加的：导航里的账号、设置里的动效、下载位置的"保存到本机"…），
 * 字典里查不到就会原样显示简中 —— 在英文界面里很扎眼。这里手工补上，
 * 只收"我们自己造、且会出现在界面上"的词，别拿它当通用翻译表用。
 */
const EXTRA = [
  ["账号", "Account", "帳號"],
  ["动效", "Motion", "動效"],
  ["流畅", "Smooth", "流暢"],
  ["精简", "Reduced", "精簡"],
  ["产物", "Files", "產物"],
  ["保存到", "Save to", "儲存到"],
  ["选择本机文件夹", "Choose a local folder", "選擇本機資料夾"],
  ["这里浏览的是运行服务的那台机器（{host}）上的目录", "These folders are on the machine running the service ({host})", "這裡瀏覽的是執行服務的那台機器（{host}）上的目錄"],
  ["目录在运行服务的那台机器（{host}）上", "Folders are on the machine running the service ({host})", "目錄在執行服務的那台機器（{host}）上"],
  ["—— 服务就跑在这台电脑上，所以显示的是本机路径", " — the service runs on this computer, so these are local paths", " —— 服務就跑在這台電腦上，所以顯示的是本機路徑"],
  ["—— 如果服务跑在容器里，这里要填容器内的路径（注意宿主机目录已挂载进去）", " — if the service runs in a container, use the container-internal path (make sure the host folder is mounted)", " —— 如果服務跑在容器裡，這裡要填容器內的路徑（注意宿主機目錄已掛載進去）"],
  ["—— 服务就跑在这台电脑上，所以看到的是本机路径", " — the service runs on this very computer, so these are local paths", " —— 服務就跑在這台電腦上，所以看到的是本機路徑"],
  ["或直接输入路径：NAS 网络共享 \\\\NAS\\media、映射盘 Z:\\\\media、容器内路径…", "Or type a path directly: NAS share \\\\NAS\\media, mapped drive Z:\\\\media, container path…", "或直接輸入路徑：NAS 網路共享 \\\\NAS\\media、對應磁碟 Z:\\\\media、容器內路徑…"],
  ["点击目录进入子目录，路径会同步到底部输入框；也可以直接在下面输入网络路径。", "Tap a folder to enter it (the path syncs to the box below); you can also type a network path directly.", "點目錄進入子目錄，路徑會同步到底部輸入框；也可以直接在下面輸入網路路徑。"],
  ["本机文件夹", "Local folder", "本機資料夾"],
  ["未选择", "Not selected", "未選擇"],
  ["已授权本机文件夹", "Local folder authorized", "已授權本機資料夾"],
  ["已清除本机文件夹授权", "Local folder authorization cleared", "已清除本機資料夾授權"],
  ["这个浏览器不支持选择本机文件夹（手机浏览器都不支持）", "This browser can't choose a local folder (mobile browsers can't either)", "這個瀏覽器不支援選擇本機資料夾（手機瀏覽器都不支援）"],
  ["选择产物默认存到 NAS 还是本机", "Choose whether files go to the NAS or to this device by default", "選擇產物預設存到 NAS 還是本機"],
  ["当前浏览器不支持选择本机文件夹（手机浏览器都不支持）：产物会进浏览器默认的下载文件夹", "This browser can't choose a local folder (mobile browsers can't either): files go to the browser's default download folder", "當前瀏覽器不支援選擇本機資料夾（手機瀏覽器都不支援）：產物會進瀏覽器預設的下載資料夾"],
  ["「保存到本机」的产物会直接写进这个文件夹；浏览器不暴露完整路径，只显示文件夹名", "Files saved to this device are written straight into this folder; browsers don't expose the full path, so only the folder name is shown", "「儲存到本機」的產物會直接寫進這個資料夾；瀏覽器不暴露完整路徑，只顯示資料夾名"],
  ["还没选：点右边的按钮授权一个本机文件夹（只显示文件夹名，浏览器不给完整路径）", "Not chosen yet: use the button on the right to authorize a local folder (only its name is shown — browsers don't expose full paths)", "還沒選：點右邊的按鈕授權一個本機資料夾（只顯示資料夾名，瀏覽器不給完整路徑）"],
  ["本机模式：产物先落服务器的临时投递目录，取回本机后即删（服务器不留副本）", "This-device mode: files land in a temporary folder on the server and are deleted once you pull them", "本機模式：產物先落伺服器的臨時投遞目錄，取回本機後即刪（伺服器不留副本）"],
  ["NAS 模式：产物存到服务器（NAS）的下载目录，可在「产物」页浏览/下载", "NAS mode: files are stored in the server's download folder and can be browsed on the Files page", "NAS 模式：產物存到伺服器（NAS）的下載目錄，可在「產物」頁瀏覽/下載"],
  ["这是服务器（NAS）上的目录，不是你电脑的", "This is a folder on the server (NAS), not on your computer", "這是伺服器（NAS）上的目錄，不是你電腦的"],
  ["本机", "This device", "本機"],
  ["NAS（服务器）", "NAS (server)", "NAS（伺服器）"],
  ["保存到本机", "Save to this device", "儲存到本機"],
  ["另存为…", "Save as…", "另存為…"],
  ["已取回", "Saved", "已取回"],
  ["将保存到本机", "Will save to this device", "將儲存到本機"],
  ["服务器上的目录", "Folder on the server", "伺服器上的目錄"],
  ["正在推送到本机…服务器副本会在推送完成后删除", "Sending to your device… the server copy is removed once it finishes", "正在推送到本機…伺服器副本會在推送完成後刪除"],
  ["已保存到本机；服务器副本已删除", "Saved to this device; the server copy was removed", "已儲存到本機；伺服器副本已刪除"],
  ["已交给浏览器下载；手机浏览器不能选目录，文件在系统「下载」里", "Handed to the browser; mobile browsers can't pick a folder — check the system Downloads", "已交給瀏覽器下載；手機瀏覽器不能選目錄，檔案在系統「下載」裡"],
  ["服务器副本已被取走：请看浏览器的下载文件夹（或重新下载该任务）", "The server copy is already gone — check your browser downloads (or re-download the task)", "伺服器副本已被取走：請看瀏覽器的下載資料夾（或重新下載該任務）"],
  ["保存失败：请重试，或改用「产物」页下载", "Save failed — retry, or download from the Files page", "儲存失敗：請重試，或改用「產物」頁下載"],
  ["下载完成后点任务上的「另存为…」自己选文件夹与文件名；服务器不留副本。", "When done, use “Save as…” on the task to pick a folder and file name; no copy is kept on the server.", "下載完成後點任務上的「另存為…」自己選資料夾與檔名；伺服器不留副本。"],
  ["下载完成后点任务上的「保存到本机」：文件进浏览器下载文件夹（手机浏览器不允许网页选目录）。", "When done, tap “Save to this device” on the task; the file goes to your browser's download folder (mobile browsers don't allow choosing a folder).", "下載完成後點任務上的「儲存到本機」：檔案進瀏覽器下載資料夾（手機瀏覽器不允許網頁選目錄）。"],
  ["再次保存到本机", "Save to this device again", "再次儲存到本機"],
  ["服务器不留副本：推送到你的浏览器后会删除", "No copy is kept on the server: deleted once sent to your browser", "伺服器不留副本：推送到你的瀏覽器後會刪除"],
];

const entries = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], "zh"));
for (const [zh, en, tw] of EXTRA) {
  if (map.has(zh)) continue; // 原版已有同名键就别覆盖
  entries.push([zh, { en, tw }]);
}
entries.sort((a, b) => a[0].localeCompare(b[0], "zh"));
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
