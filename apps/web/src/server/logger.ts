import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

/**
 * 应用日志 —— 对齐桌面版 `main.py:92-121`：
 *
 * - 文件 `<data>/logs/app.log`
 * - 行格式 `[时间] - name - LEVEL - at文件:行号 in函数: 消息`
 *   （时间到微秒：`%Y-%m-%d %H:%M:%S.%f`）
 * - **午夜切割**，保留 15 份（备份名 `app.log.YYYY-MM-DD`，与 Python
 *   `TimedRotatingFileHandler` 的命名一致）
 *
 * 桌面版用 `logging` 模块，这里是等价的最小实现 —— 不引第三方日志库，
 * 因为要的只是"同一个格式、同一个切割策略"，而不是完整的 logging 生态。
 */

export type LogLevel = "DEBUG" | "INFO" | "WARNING" | "ERROR" | "CRITICAL";

/** 解析后的日志条目（客户端 `services/types.ts` 有同名镜像） */
export interface LogEntry {
  timestamp: string;
  name: string;
  level: string;
  callsite: string;
  message: string;
}

/**
 * 行正则 —— 与桌面版 `dialog/log.py` 用的那条一致：
 * `\[(?P<timestamp>.*)\] - (?P<name>.+?) - (?P<level>\w+) - (?P<callsite>.+?): (?P<message>.*)`
 * **不匹配的行会被追加到上一条的 message**（多行堆栈就是这么进来的）。
 */
const LINE_RE = /^\[(.*)\] - (.+?) - (\w+) - (.+?): (.*)$/;

/** 全局单例：服务端的模块都往这里写 */
let current: FileLogger | undefined;

export class FileLogger {
  readonly #dir: string;
  readonly #file: string;
  #day: string;

  constructor(logDir: string) {
    this.#dir = logDir;
    mkdirSync(logDir, { recursive: true });
    this.#file = join(logDir, "app.log");
    this.#day = FileLogger.#today();
  }

  static #today(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  /** 时间戳：`%Y-%m-%d %H:%M:%S.%f`（微秒，与桌面版一致；Node 只有毫秒，后三位补 0） */
  static #stamp(): string {
    const d = new Date();
    const p = (n: number, w = 2) => String(n).padStart(w, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}000`;
  }

  /** 调用点：`文件:行号 in 函数`（等价于 Python 的 `%(filename)s:%(lineno)d in %(funcName)s`） */
  static #callsite(): string {
    const lines = new Error().stack?.split("\n").slice(1) ?? [];
    for (const line of lines) {
      if (line.includes("logger.")) continue;
      const m = /at (?:(.+?) )?\(?(.+?):(\d+):\d+\)?$/.exec(line.trim());
      if (!m) continue;
      const fn = m[1] ?? "<anonymous>";
      return `${basename(m[2]!)}:${m[3]} in ${fn}`;
    }
    return "unknown:0 in unknown";
  }

  /** 午夜切割：把当前文件改名成 `app.log.<前一天>`，只留最近 15 份 */
  #rotateIfNeeded(): void {
    const today = FileLogger.#today();
    if (today === this.#day) return;
    try {
      if (existsSync(this.#file)) renameSync(this.#file, `${this.#file}.${this.#day}`);
      const backups = readdirSync(this.#dir)
        .filter((f) => f.startsWith("app.log."))
        .sort();
      for (const old of backups.slice(0, Math.max(0, backups.length - 15))) {
        rmSync(join(this.#dir, old), { force: true });
      }
    } catch {
      // 切割失败不该影响主流程：继续往原文件写
    }
    this.#day = today;
  }

  write(level: LogLevel, name: string, message: string): void {
    this.#rotateIfNeeded();
    // ⚠️ **不转义换行**：桌面版的多行堆栈就是按物理行写进文件、解析时再拼回上一条的
    //（`parseLogText` 的"不匹配行追加到上一条"规则正是为此存在）。
    // 我第一版把 \n 转义成字面 `\n`，结果是"写进去能读、但不是原版的文件形态"，
    // 而且详情里再也看不到真正的多行 —— 已改回原样写入。
    const line = `[${FileLogger.#stamp()}] - ${name} - ${level} - at ${FileLogger.#callsite()}: ${message}\n`;
    try {
      appendFileSync(this.#file, line, "utf8");
    } catch {
      // 写日志失败不能把业务带崩
    }
  }

  info(name: string, message: string): void { this.write("INFO", name, message); }
  warn(name: string, message: string): void { this.write("WARNING", name, message); }
  error(name: string, message: string): void { this.write("ERROR", name, message); }

  /** 日志文件路径（"打开日志目录"用不到，但排查时要能知道在哪） */
  get filePath(): string { return this.#file; }

  /** 读取并解析（最多 `limit` 条，取**最新的**；`search` 对整条文本做包含匹配） */
  read(opts: { search?: string; limit?: number } = {}): LogEntry[] {
    const limit = opts.limit ?? 1000;
    let raw = "";
    try {
      raw = existsSync(this.#file) ? readFileSync(this.#file, "utf8") : "";
    } catch {
      return [];
    }
    const entries = parseLogText(raw);
    const kw = opts.search?.trim().toLowerCase();
    const filtered = kw
      ? entries.filter((e) => `${e.timestamp} ${e.name} ${e.level} ${e.callsite} ${e.message}`.toLowerCase().includes(kw))
      : entries;
    return filtered.slice(-limit).reverse(); // 最新的在最前（桌面版列表也是新→旧）
  }

  /** 清空当前日志文件（桌面版「清除日志」） */
  clear(): void {
    try {
      writeFileSync(this.#file, "", "utf8");
    } catch {
      // 忽略
    }
  }
}

/** 把日志文本解析成条目；不匹配的行追加到上一条的 message（含多行堆栈） */
export function parseLogText(raw: string): LogEntry[] {
  const out: LogEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line === "") continue;
    const m = LINE_RE.exec(line);
    if (m) {
      out.push({ timestamp: m[1]!, name: m[2]!, level: m[3]!, callsite: m[4]!, message: m[5]! });
    } else if (out.length) {
      out[out.length - 1]!.message += `\n${line}`;
    }
    // 文件开头的孤儿行直接丢（没有上一条可挂）
  }
  return out;
}

/** 初始化全局日志（服务端启动时调一次） */
export function initLogger(logDir: string): FileLogger {
  current = new FileLogger(logDir);
  current.info("main", "日志已初始化");
  return current;
}

/** 取全局日志；未初始化时返回一个空实现，避免调用点到处判空 */
export function logger(): FileLogger | undefined {
  return current;
}

/** 便捷写法：没初始化就静默丢弃 */
export function logInfo(name: string, message: string): void { current?.info(name, message); }
export function logWarn(name: string, message: string): void { current?.warn(name, message); }
export function logError(name: string, message: string): void { current?.error(name, message); }
