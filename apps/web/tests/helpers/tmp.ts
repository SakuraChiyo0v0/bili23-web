import { mkdtemp, rm } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

/**
 * 测试用临时目录 —— **用完自动清理**。
 *
 * 为什么要有这个文件：2026-09-13 发现本机 Temp 里积了 **2159 个 `bili23-*` 目录、1.46 GB**，
 * 全是 4 个测试文件（api / mcp / config / logger）里直接 `mkdtemp` 造的 —— 每个用例造一个，
 * **从不清理**，跑一次测试就漏几个（光 `bili23-deliver-*` 就有 1238 个）。
 *
 * 用法：把 `mkdtemp(join(tmpdir(), "bili23-xxx-"))` 换成 `tmpDir("bili23-xxx-")`；
 * 同步场景用 `tmpDirSync`。清理由本模块的 `afterAll` 统一执行
 * （每个测试文件各自 import 一次，注册的就是**该文件**的 afterAll）。
 *
 * ⚠️ Windows 上还有第二道坑：**打开了 SQLite / 文件句柄的目录删不掉**。
 * 所以：
 * 1. 用完的 `DownloadManager` / `ConfigStore` 要 `onCleanup(() => x.close())` 登记关闭，
 *    清理时会**先关句柄、再删目录**；
 * 2. 删除带 `maxRetries`（杀毒/索引等瞬时占用也能过）。
 */
const created: string[] = [];
const closers: Array<() => void | Promise<void>> = [];

/** 登记"删目录之前要做的事"（例如关掉 SQLite 句柄）。按登记的**逆序**执行 */
export function onCleanup(fn: () => void | Promise<void>): void {
  closers.push(fn);
}

export async function tmpDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

export function tmpDirSync(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

afterAll(async () => {
  for (const fn of [...closers].reverse()) {
    await Promise.resolve(fn()).catch(() => undefined);
  }
  closers.length = 0;
  await Promise.all(
    created.map((dir) =>
      rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined),
    ),
  );
  created.length = 0;
});
