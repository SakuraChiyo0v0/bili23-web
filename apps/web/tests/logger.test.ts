import { describe, expect, it, vi } from "vitest";
import { FileLogger, parseLogText } from "../src/server/logger.js";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpDir } from "./helpers/tmp.js";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * 日志格式与解析 —— 对齐桌面版 `main.py:92-121` / `dialog/log.py`。
 * 这里钉住两件容易出错的事：**行格式**（写入）与**多行堆栈**（解析）。
 */
describe("日志解析（桌面 dialog/log.py 的同一条正则）", () => {
  it("标准行解析出五段", () => {
    const text = "[2026-09-12 23:30:01.123000] - parse - INFO - at video.py:42 in parse_video: 开始解析，链接: BV1\n";
    const out = parseLogText(text);
    expect(out).toHaveLength(1);
    const e = out[0]!;
    // ⚠️ callsite **带前导 "at "** —— 格式串是 `... - at %(callsite)s: %(message)s`，
    //    而原版那条正则捕获的是 `- ` 与 `: ` 之间的全部内容，所以 "at " 也在捕获组里。
    //    （桌面版详情里因此显示成 `Name: parse (at video.py:42 in parse_video)`，是同一个原因。）
    expect(e.timestamp).toBe("2026-09-12 23:30:01.123000");
    expect(e.name).toBe("parse");
    expect(e.level).toBe("INFO");
    expect(e.callsite).toBe("at video.py:42 in parse_video");
    expect(e.message).toBe("开始解析，链接: BV1");
  });

  it("不匹配的行**追加到上一条的 message**（多行堆栈就是这么进来的）", () => {
    const text = [
      "[2026-09-12 23:30:01.123000] - download - ERROR - at m.py:9 in run: 失败：boom",
      "Traceback (most recent call last):",
      '  File "x.py", line 1',
      "[2026-09-12 23:30:02.000000] - download - INFO - at m.py:20 in go: 下一条",
    ].join("\n");
    const out = parseLogText(text);
    expect(out).toHaveLength(2);
    expect(out[0]!.message).toBe('失败：boom\nTraceback (most recent call last):\n  File "x.py", line 1');
    expect(out[1]!.message).toBe("下一条");
  });

  it("文件开头的孤儿行被丢掉（没有上一条可挂）", () => {
    expect(parseLogText("乱码行\n[2026-09-12 23:30:01.123000] - a - INFO - at b.py:1 in f: ok")).toHaveLength(1);
  });

  it("空文本 → 空数组", () => {
    expect(parseLogText("")).toEqual([]);
  });
});

describe("FileLogger 写入与读取", () => {
  it("写入的行能被自己解析回来（格式自洽）；message 里的换行按物理行写、解析时拼回", async () => {
    const dir = await tmpDir("bili23-log-");
    try {
      const logger = new FileLogger(dir);
      logger.info("unit", "第一行\n第二行");
      logger.warn("unit", "警告一条");
      logger.error("unit", "错误一条");

      const raw = await readFile(join(dir, "app.log"), "utf8");
      // 多行 message 占两个物理行（与桌面版的堆栈一致），加上另外两条 = 4 行
      expect(raw.trimEnd().split("\n")).toHaveLength(4);
      // callsite 形如 `at 文件:行号 in 函数`（调用点在测试文件里，不在 logger 内部）
      expect(raw).toMatch(/at \S+:\d+ in /);
      expect(raw).not.toContain("at logger.js:");

      const entries = logger.read();
      expect(entries).toHaveLength(3);
      // 最新的在最前
      expect(entries[0]!.message).toBe("错误一条");
      expect(entries[0]!.level).toBe("ERROR");
      // 换行被解析拼回（真换行，不是字面 \n）
      expect(entries[2]!.message).toBe("第一行\n第二行");
      expect(entries[2]!.message).toContain("\n");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("search 对整条文本做包含匹配（时间/名字/级别/调用点/正文都算）", async () => {
    const dir = await tmpDir("bili23-log-");
    try {
      const logger = new FileLogger(dir);
      logger.info("parse", "解析完成 alpha");
      logger.info("download", "下载完成 beta");
      expect(logger.read({ search: "alpha" }).map((e) => e.name)).toEqual(["parse"]);
      expect(logger.read({ search: "download" }).map((e) => e.name)).toEqual(["download"]);
      expect(logger.read({ search: "不存在的关键词" })).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("limit 取最新的 N 条", async () => {
    const dir = await tmpDir("bili23-log-");
    try {
      const logger = new FileLogger(dir);
      for (let i = 1; i <= 5; i += 1) logger.info("unit", `第 ${i} 条`);
      expect(logger.read({ limit: 2 }).map((e) => e.message)).toEqual(["第 5 条", "第 4 条"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("clear 后读回空", async () => {
    const dir = await tmpDir("bili23-log-");
    try {
      const logger = new FileLogger(dir);
      logger.info("unit", "x");
      logger.clear();
      expect(logger.read()).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("跨天时切割：当前文件改名成 app.log.<前一天>，且只留最近 15 份", async () => {
    const dir = await tmpDir("bili23-log-");
    vi.useFakeTimers();
    try {
      // 造 16 个历史备份
      for (let i = 1; i <= 16; i += 1) {
        await writeFile(join(dir, `app.log.2026-08-${String(i).padStart(2, "0")}`), "x\n", "utf8");
      }
      // 第 1 天构造并在当天写一条
      vi.setSystemTime(new Date("2026-09-12T23:59:00"));
      const logger = new FileLogger(dir);
      logger.info("unit", "第一天的日志");
      // 跨到第 2 天再写 → 触发切割
      vi.setSystemTime(new Date("2026-09-13T00:00:30"));
      logger.info("unit", "第二天的日志");

      const { readdir } = await import("node:fs/promises");
      const files = (await readdir(dir)).filter((f) => f.startsWith("app.log."));
      expect(files).toHaveLength(15);                    // 只留 15 份备份
      expect(files).toContain("app.log.2026-09-12");     // 刚被切下来的那份在
      expect(await readFile(join(dir, "app.log"), "utf8")).toContain("第二天的日志");
      expect(await readFile(join(dir, "app.log"), "utf8")).not.toContain("第一天的日志");
    } finally {
      vi.useRealTimers();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
