/**
 * 端到端冒烟：对真实 B 站投稿视频走完 解析 → 选项 → 下载 → 合并 → 完成。
 * 用法：node scripts/e2e-smoke.mjs <baseUrl> [videoUrl]
 * 依赖运行中的服务端（BILI23_DATA_DIR 需指向可写目录）。
 */
import { spawnSync } from "node:child_process";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:8790";
const videoUrl =
  process.argv[3] ?? "https://www.bilibili.com/video/BV1GJ411x7h7";

async function post(path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path} -> ${JSON.stringify(json)}`);
  return json;
}

async function get(path) {
  const res = await fetch(`${baseUrl}${path}`);
  const json = await res.json();
  if (!res.ok) throw new Error(`${path} -> ${JSON.stringify(json)}`);
  return json;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const parsed = await post("/api/parse", { urls: [videoUrl] });
const all = parsed.results?.[0]?.items ?? [];
if (all.length === 0) throw new Error(`解析结果为空：${JSON.stringify(parsed).slice(0, 500)}`);
// 过滤 0 时长/空标题的失效行（历史/收藏夹可能混入），避免冒烟挑到无法下载的条目
const valid = all.filter((i) => (i.duration ?? 0) > 0 && String(i.title ?? "").trim().length > 0);
if (valid.length === 0) throw new Error(`没有有效条目（均 0 时长/空标题）：${JSON.stringify(parsed).slice(0, 500)}`);
// 冒烟默认挑时长最短的条目，控制下载体积；可传 SHORTEST=0 取首条
const item = (process.env.SHORTEST ?? "1") === "1"
  ? valid.reduce((a, b) => ((b.duration ?? 0) < (a.duration ?? 0) ? b : a))
  : valid[0];
console.log(`[parse] ${item.groupTitle} / ${item.title} (${item.id}, ${item.duration}s)`);

const options = await get(`/api/media/${encodeURIComponent(item.id)}`);
const qs = options.qualities ?? [];
const qLabels = qs.map((q) => `${q.label}(${q.id})`).join(",");
console.log(`[media] type=${options.mediaType} 画质=[${qLabels}]`);
// 默认选最低可用画质（冒烟轻量）；QUALITY=80 可显式指定
const qualityId = Number(process.env.QUALITY ?? "");
const chosen = qualityId > 0
  ? (qs.find((q) => q.id === qualityId) ?? qs[0])
  : [...qs].reverse().find((q) => q.id >= 32) ?? qs[qs.length - 1];

const created = await post("/api/download", {
  itemIds: [item.id],
  options: { videoQualityId: chosen?.id ?? 200 },
  force: true,
});
const taskId = created.tasks?.[0]?.id;
if (!taskId) throw new Error(`任务创建失败：${JSON.stringify(created)}`);
console.log(`[task] ${taskId}`);

const deadline = Date.now() + 15 * 60 * 1000;
let last = "";
while (Date.now() < deadline) {
  await sleep(2000);
  const task = await get(`/api/tasks/${taskId}`);
  const line = `[task] ${task.status} ${task.progress?.toFixed?.(1) ?? ""}% ${task.downloadedBytes ?? 0}/${task.totalBytes ?? 0}`;
  if (line !== last) {
    console.log(line);
    last = line;
  }
  if (task.status === "completed") {
    console.log(`[done] ${task.outputPath}`);
    const probe = spawnSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "stream=codec_type,codec_name", "-of", "compact", task.outputPath],
      { encoding: "utf8" },
    );
    if (probe.status !== 0) {
      console.error(`[verify] ffprobe 失败：${probe.stderr}`);
      process.exit(1);
    }
    console.log(`[verify]\n${probe.stdout.trim()}`);
    const out = probe.stdout || "";
    if (!out.includes("video") || !out.includes("audio")) {
      console.error("[verify] 产物缺少视频/音频流");
      process.exit(1);
    }
    console.log("[e2e] PASS");
    process.exit(0);
  }
  if (task.status === "failed" || task.status === "cancelled") {
    console.error(`[task] 失败：${task.error ?? task.status}`);
    process.exit(1);
  }
}
console.error("[e2e] 超时未完成");
process.exit(1);
