#!/usr/bin/env node
/**
 * 无依赖的"真机点验"探针：用 Chrome DevTools Protocol 驱动真实前端，并把**计算结果**打出来。
 *
 * 为什么不用无头截图：截图只能靠眼睛，而本仓库已经栽过两次 ——
 * ① 虚拟时间遇到轮询/长请求就不推进，Chrome 不退出；
 * ② 小字号上的肉眼判断会看错（色相那次）。
 * 这里改成"导航 → 等一会儿 → 在页面里求值 → 打印 JSON"，判据是数字与文本，不是像素。
 *
 * 用法：
 *   node apps/web/scripts/cdp-probe.mjs <url> <waitMs> "<js表达式>" ["<js表达式>" ...]
 *
 * 表达式在页面上下文里求值，返回 Promise 会被 await。打印 `EXPR n => <JSON>`。
 * 需要连续交互（点击/等待）时，把整个流程写成**一个 async IIFE 表达式**即可。
 *
 * 例（F11 未登录教学气泡）：
 *   node apps/web/scripts/cdp-probe.mjs http://127.0.0.1:3403/__seed.html 2500 \
 *     "document.querySelectorAll('.teaching-tip').length" \
 *     "JSON.stringify([...document.querySelectorAll('.teaching-tip')].map(e=>e.innerText))"
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

const [url, waitMsRaw, ...exprs] = process.argv.slice(2);
if (!url) {
  console.error("用法: node cdp-probe.mjs <url> <waitMs> \"<js表达式>\" [...]");
  process.exit(2);
}
const waitMs = Number(waitMsRaw ?? 2000);
const port = 9000 + Math.floor(Math.random() * 900);
const profile = await mkdtemp(join(tmpdir(), "cdp-probe-"));

const chrome = spawn(CHROME, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "--hide-scrollbars",
  // 窗口尺寸默认 1280×900；要验窄屏就设环境变量 PROBE_WINDOW=420,820
  `--window-size=${process.env.PROBE_WINDOW ?? "1280,900"}`,
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 等 DevTools HTTP 端点起来，并取到页面 target 的 ws 地址 */
async function pageTarget() {
  for (let i = 0; i < 100; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // 还没起来
    }
    await sleep(100);
  }
  throw new Error("等不到 DevTools 端点");
}

let msgId = 0;
const pending = new Map();
let ws;

function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

try {
  const wsUrl = await pageTarget();
  ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  ws.addEventListener("message", (ev) => {
    let msg;
    try { msg = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data)); } catch { return; }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  });

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.navigate", { url });
  await sleep(waitMs);

  let n = 0;
  for (const expr of exprs) {
    n += 1;
    const out = await send("Runtime.evaluate", {
      expression: `(async () => { return (${expr}); })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (out.exceptionDetails) {
      console.log(`EXPR ${n} => 抛错: ${out.exceptionDetails.text} ${out.exceptionDetails.exception?.description ?? ""}`);
    } else {
      console.log(`EXPR ${n} => ${JSON.stringify(out.result?.value)}`);
    }
  }
} catch (err) {
  console.error("探针失败:", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  chrome.kill();
  await sleep(300);
  await rm(profile, { recursive: true, force: true }).catch(() => undefined);
}
