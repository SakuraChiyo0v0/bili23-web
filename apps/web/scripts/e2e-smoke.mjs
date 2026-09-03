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
const item = parsed.results?.[0]?.items?.[0];
if (!item) throw new Error(`解析结果为空：${JSON.stringify(parsed).slice(0, 500)}`);
console.log(`[parse] ${item.groupTitle} / ${item.title} (${item.id})`);

const options = await get(`/api/media/${encodeURIComponent(item.id)}`);
console.log(
  `[media] type=${options.mediaType} 画质=[${options.qualities.map((q) => `${q.label}(${q.id})`).join(",")}]`,
);

const created = await post("/api/download", {
  itemIds: [item.id],
  options: { videoQualityId: options.qualities[0]?.id ?? 200 },
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
