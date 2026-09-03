import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { mkdir, readFile, readdir, rm, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import {
  BiliError,
  DownloadAbortedError,
  HistoryService,
  SpeedGate,
  HttpClient,
  TaskStore,
  calcHashId,
  concatMediaParts,
  ensureAnonymousSession,
  BILI_API_BASE,
  classifyUrl,
  downloadFile,
  fetchPlayMediaInfo,
  mergeAudioVideo,
  parseUrl,
  probeMedia,
  probeStreamUrl,
  remuxMedia,
  resolveStreams,
  audioQualityLabel,
  videoQualityLabel,
} from "@bili23-web/engine";
import type {
  ChunkState,
  MediaItem,
  ParseContext,
  ParseResult,
  ResolvedStreams,
  StreamOptions,
  VideoMediaInfo,
  ParseHistoryEntry,
} from "@bili23-web/engine";
import {
  DEFAULT_EXTRAS_OPTIONS,
  DEFAULT_NAMING_RULES,
  NumberingAllocator,
  VIDEO_CODEC_STR,
  parseDanmakuXml,
  danmakuToAss,
  danmakuToJson,
  danmakuToXml,
  toSubtitleSrt,
  toSubtitleLrc,
  toSubtitleTxt,
  toSubtitleAss,
  toSubtitleJson,
  subtitleTrackTitle,
  toIso639_2,
  fetchDanmakuXml,
  fetchPlayerInfo,
  fetchSubtitlesData,
  fetchCoverBytes,
  fetchVideoTags,
  buildChapterFfmetadata,
  chapterFileName,
  buildMetadataJson,
  buildMetadataNfo,
  formatFileName,
  buildNamingVariables,
  resolveConventionType,
  type ExtrasOptions,
  type DanmakuFormat,
  type SubtitleFormat,
  type CoverFormat,
  type MetadataFormat,
  type PlayerInfo,
  type SubtitleDataEntry,
  type SubtitleTrackSpec,
  type SubtitleJson,
  type SubtitleStyle,
  type MetadataInput,
  type NamingRule,
  type NamingQuality,
  type NumberingTypeId,
} from "@bili23-web/engine";
import { ConfigStore, deepMerge } from "./config.js";
import type { AppConfig, AppConfigPatch } from "./config.js";

/**
 * 服务端下载任务管理器（进程内队列 + SQLite 持久化 + SSE 订阅）。
 * 语义对应桌面 task/manager.py + downloader：
 * 解析会话（条目）进程内保留；任务创建即落库；每文件先探测候选再逐文件下载，
 * 下载完进入 ffmpeg 合并，成功后移入历史、产物落盘 <downloadDir>/<分类目录>。
 */

export type TaskStatus =
  | "queued"
  | "parsing"
  | "downloading"
  | "merging"
  | "paused"
  | "interrupted"
  | "completed"
  | "failed"
  | "cancelled";

export interface DownloadOptions {
  videoQualityId?: number;
  videoCodecId?: number;
  audioQualityId?: number;
  /** 输出容器，默认 mp4 */
  container?: "mp4" | "mkv";
  /** 附加内容快照（组缺省由服务端全局附加配置补齐后固化，R-208） */
  extras?: ExtrasOptions;
  /** 命名/编号快照（创建任务时按命名规则 + 编号模式固化） */
  naming?: { conventionType: number; rule: string; number: number | "" };
}

export interface TaskSummary {
  id: string;
  status: TaskStatus;
  title: string;
  groupTitle: string;
  progress: number;
  downloadedBytes: number;
  totalBytes: number;
  outputPath?: string | undefined;
  error?: string | undefined;
  createdAt: number;
  updatedAt: number;
  qualityLabel: string;
  /** 本次运行开始时间（Unix 秒） */
  startedAt?: number | undefined;
  /** 下载速率（字节/秒），仅 downloading 阶段有效 */
  speedBps?: number | undefined;
  /** 预估剩余秒数，仅 downloading 阶段有效 */
  etaSec?: number | undefined;
}

export interface MediaOptionSummary {
  itemId: string;
  mediaType: "dash" | "mp4";
  timelength: number;
  /** 可选画质（含该画质可用编码） */
  qualities: Array<{ id: number; label: string; codecs: Array<{ id: number; label: string }> }>;
  audioQualities: Array<{ id: number; label: string }>;
}

export interface FileEntry {
  name: string;
  /** 相对下载根目录的路径（正斜杠） */
  path: string;
  size: number;
  mtime: number;
}

export interface TaskSnapshot {
  item: MediaItem;
  options: DownloadOptions;
  status: TaskStatus;
  /** 文件 key → 分片断点快照（断点续传） */
  files: Record<string, ChunkState>;
}

/** 已完成历史条目 DTO（completed_task 表映射，含重启前完成项） */
export interface HistoryEntryDto {
  taskId: string;
  title: string;
  /** 完成时间（Unix 秒） */
  completedAt: number;
  /** 产物绝对路径 */
  outputPath?: string | undefined;
  error?: string | undefined;
}

/** 正在运行（占用并发槽位）的状态集合 */
const RUNNING_STATUSES = new Set<TaskStatus>(["parsing", "downloading", "merging"]);

/** 规范化下载根内相对路径并防目录穿越；越界/非法返回 undefined */
export function resolveDownloadPath(rootDir: string, relPath: string): string | undefined {
  const abs = resolve(rootDir, relPath);
  const prefix = rootDir.endsWith(sep) ? rootDir : rootDir + sep;
  if (abs !== rootDir && !abs.startsWith(prefix)) return undefined;
  return abs;
}

type Listener = (summary: TaskSummary) => void;

function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\r\n\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || "video").slice(0, 120);
}

function codecLabel(id: number): string {
  return ({ 7: "AVC/H.264", 12: "HEVC/H.265", 13: "AV1" } as Record<number, string>)[id] ?? `编码${id}`;
}

interface PlannedFile {
  key: string;
  urls: string[];
  fileName: string;
}

interface MergePlan {
  kind: "dash" | "parts";
  videoKey: string;
  audioKey?: string;
  partKeys: string[];
}

/** 附加内容收集结果（P3）：merge=内嵌参数（相对 taskDir），独立文件内容随后落盘 */
interface GatheredExtras {
  merge?: { subtitleTracks?: SubtitleTrackSpec[]; coverPath?: string; chapterPath?: string };
  danmaku?: { format: DanmakuFormat; contents: string; skipFile: boolean };
  subtitles?: Array<{ format: SubtitleFormat; language: string; languageDoc: string; contents: string; skipFile: boolean }>;
  cover?: { format: CoverFormat; bytes: Uint8Array; skipFile: boolean };
}

class ManagedTask {
  readonly id: string;
  readonly item: MediaItem;
  readonly options: DownloadOptions;
  status: TaskStatus = "queued";
  progress = 0;
  downloadedBytes = 0;
  totalBytes = 0;
  outputPath?: string | undefined;
  error?: string | undefined;
  createdAt = Math.floor(Date.now() / 1000);
  updatedAt = this.createdAt;
  duplicate = false;
  /** 断点快照（file key → 分片状态）；init 恢复/暂停/取消时保留，供续传 */
  files: Record<string, ChunkState> = {};
  /** 用户意图：paused=暂停（保留断点），cancelled=取消/删除（清理） */
  requestedState?: "paused" | "cancelled" | undefined;
  /** 当前 #run 的 Promise（删除时等待其收尾再清理目录） */
  runPromise?: Promise<void> | undefined;
  /** 本次运行开始时间（Unix 秒） */
  startedAt?: number | undefined;
  /** 下载速率（字节/秒），仅 downloading 阶段有效 */
  speedBps = 0;
  /** 预估剩余秒数，仅 downloading 阶段有效 */
  etaSec = 0;
  #abort = new AbortController();
  readonly #listeners = new Set<Listener>();
  /** 任务生命周期日志（环形，上限 200 行） */
  readonly #log: string[] = [];

  constructor(item: MediaItem, options: DownloadOptions, id?: string) {
    this.id = id ?? randomUUID();
    this.item = item;
    this.options = options;
  }

  get aborted(): boolean {
    return this.#abort.signal.aborted;
  }

  get signal(): AbortSignal {
    return this.#abort.signal;
  }

  summary(): TaskSummary {
    return {
      id: this.id,
      status: this.status,
      title: this.item.title,
      groupTitle: this.item.groupTitle,
      progress: this.progress,
      downloadedBytes: this.downloadedBytes,
      totalBytes: this.totalBytes,
      outputPath: this.outputPath,
      error: this.error,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      qualityLabel: videoQualityLabel(this.options.videoQualityId ?? 200),
      startedAt: this.startedAt,
      speedBps: this.status === "downloading" ? this.speedBps : undefined,
      etaSec: this.status === "downloading" ? this.etaSec : undefined,
    };
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    listener(this.summary());
    return () => this.#listeners.delete(listener);
  }

  update(patch: Partial<TaskSummary>): void {
    if (patch.status) this.status = patch.status;
    if (patch.progress !== undefined) this.progress = patch.progress;
    if (patch.downloadedBytes !== undefined) this.downloadedBytes = patch.downloadedBytes;
    if (patch.totalBytes !== undefined) this.totalBytes = patch.totalBytes;
    if (patch.outputPath !== undefined) this.outputPath = patch.outputPath;
    if (patch.error !== undefined) this.error = patch.error;
    if (patch.speedBps !== undefined) this.speedBps = patch.speedBps;
    if (patch.etaSec !== undefined) this.etaSec = patch.etaSec;
    if (patch.startedAt !== undefined) this.startedAt = patch.startedAt;
    this.updatedAt = Math.floor(Date.now() / 1000);
    const summary = this.summary();
    for (const l of [...this.#listeners]) l(summary);
  }

  /** 记录一行任务日志（环形，超上限丢弃最旧） */
  pushLog(message: string): void {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    this.#log.push("[" + hh + ":" + mm + ":" + ss + "] " + message);
    if (this.#log.length > 200) this.#log.splice(0, this.#log.length - 200);
  }

  logLines(): string[] {
    return [...this.#log];
  }

  /** 暂停：置意图后中止（#run 收尾时保留断点与 download_task 行） */
  pause(): void {
    this.requestedState = "paused";
    this.#abort.abort();
  }

  /** 取消：置意图后中止（#run 收尾时按取消清理） */
  cancel(): void {
    this.requestedState = "cancelled";
    this.#abort.abort();
  }

  /** 重新运行前重置中止状态与意图（resume/retry 用） */
  resetForRun(): void {
    this.requestedState = undefined;
    this.#abort = new AbortController();
  }
}

export interface ParseRequest {
  /** 链接数组（type 为空时使用） */
  urls?: string[];
  /** 类型入口：video/bangumi/cheese/lesson/audio/space/favlist/popular/watch_later/history */
  type?: string;
  /** 类型入口的输入：链接 / UID / 用户名 / 收藏夹链接 */
  query?: string;
  /** 可选关键词（space/favlist/history/watch_later 支持） */
  keyword?: string;
  /** 每周必看期数（popular 用，默认 1） */
  weekNum?: number;
  /** 起始页（space/favlist/history/watch_later/list 等分页类型，默认 1） */
  pn?: number;
  /** 翻页数（分页类型，默认 1） */
  pages?: number;
}

export interface AuthStatus {
  loggedIn: boolean;
  /** 脱敏后的 SESSDATA 预览（如 "abc…1234"），便于 UI 提示已登录 */
  preview: string;
}

export class DownloadManager {
  #http: HttpClient;
  #store: TaskStore;
  #history: HistoryService;
  /** 匿名会话引导（buvid/bili_ticket 等指纹 cookie），首次解析前就绪（最佳努力，不失败） */
  #sessionReady: Promise<void>;
  #rootDir: string;
  #tmpDir: string;
  #tasks = new Map<string, ManagedTask>();
  #items = new Map<string, MediaItem>();
  #configStore: ConfigStore;
  #configReady: Promise<void>;
  /** 全局限速门（跨任务共享；0=不限速，由 config.download.speedLimitKbps 驱动） */
  #gate: SpeedGate;
  /** 并发运行上限（config.download.parallel，默认 2；新任务创建/设置变更时刷新） */
  #maxParallel = 2;
  /** 单文件分片并发（config.download.threads，默认 4） */
  #maxThreads = 4;
  /** FIFO 等待队列（仅 status=queued 的任务） */
  #pending: ManagedTask[] = [];
  /** init 幂等标记 */
  #initPromise?: Promise<void> | undefined;
  #dataDir: string;
  /** 当前 SESSDATA（未登录为 undefined）；持久化于 <data>/auth.json */
  #sessdata: string | undefined;
  /** CDN 节点（advanced.cdnHosts），取流时作为候选地址前缀 */
  #cdnHosts: string[] = [];
  /** 自定义 ffmpeg 可执行文件路径（advanced.ffmpegPath） */
  #ffmpegPath: string | undefined = undefined;

  constructor(opts: { dataDir: string; downloadDir?: string }) {
    this.#http = new HttpClient();
    this.#sessionReady = ensureAnonymousSession(this.ctx);
    this.#dataDir = opts.dataDir;
    this.#rootDir = opts.downloadDir ?? join(opts.dataDir, "downloads");
    this.#tmpDir = join(this.#rootDir, ".tmp");
    // 同步建目录：TaskStore/ConfigStore 打开 SQLite 前目录必须已存在
    mkdirSync(opts.dataDir, { recursive: true });
    mkdirSync(this.#rootDir, { recursive: true });
    mkdirSync(this.#tmpDir, { recursive: true });
    this.#store = new TaskStore(join(opts.dataDir, "task.db"));
    this.#history = new HistoryService(this.#store);
    this.#configStore = new ConfigStore(join(opts.dataDir, "config.json"));
    // 全局限速门初始 0（不限）；配置就绪后按 speedLimitKbps 生效
    this.#gate = new SpeedGate(0);
    this.#configReady = this.#configStore.load().then(() => {
      this.#applyRuntimeConfig(this.#configStore.get());
    });
  }

  get ctx(): ParseContext {
    return { http: this.#http };
  }

  close(): void {
    this.#store.close();
  }

  /** 重启恢复：读 download_task 遗留任务标为 interrupted（保留 .part 与断点，可手动继续）。幂等。 */
  async init(): Promise<void> {
    if (!this.#initPromise) {
      this.#initPromise = this.#loadAuth().then(() => this.#rehydrate());
    }
    return this.#initPromise;
  }

  // ---------- 全局设置（附加内容默认值 / 命名规则 / 编号）----------

  async getConfig(): Promise<AppConfig> {
    await this.#configReady;
    return this.#configStore.get();
  }

  async updateConfig(patch: AppConfigPatch): Promise<AppConfig> {
    await this.#configReady;
    const prev = this.#configStore.get();
    const next = await this.#configStore.update(patch);
    // 全局限速即时生效：speedLimitKbps 变化时更新共享门
    if (next.download.speedLimitKbps !== prev.download.speedLimitKbps) {
      this.#gate.setBps(next.download.speedLimitKbps * 1024);
    }
    this.#maxParallel = next.download.parallel;
    this.#maxThreads = next.download.threads;
    // 并行上限变化后立即按新值推进队列（调大时 queued 任务马上补位，调小则保持现状）
    this.#scheduleNext();
    return next;
  }

  // ---------- 登录（SESSDATA cookie）----------

  async loginAuth(sessdata: string): Promise<AuthStatus> {
    const s = sessdata.trim();
    if (!s) throw new BiliError("INVALID_URL", "SESSDATA 不能为空");
    this.#sessdata = s;
    this.#http.jar.set("SESSDATA", s);
    await this.#persistAuth();
    return { loggedIn: true, preview: this.#previewSessdata(s) };
  }

  async logoutAuth(): Promise<AuthStatus> {
    this.#sessdata = undefined;
    this.#http.jar.delete("SESSDATA", "bili_jct", "DedeUserID", "DedeUserID__ckMd5");
    try {
      await rm(join(this.#dataDir, "auth.json"), { force: true });
    } catch {
      // 文件已不存在则忽略
    }
    return { loggedIn: false, preview: "" };
  }

  async authStatus(): Promise<AuthStatus> {
    return {
      loggedIn: !!this.#sessdata,
      preview: this.#sessdata ? this.#previewSessdata(this.#sessdata) : "",
    };
  }

  #previewSessdata(s: string): string {
    if (s.length <= 10) return s;
    return `${s.slice(0, 4)}…${s.slice(-4)}`;
  }

  async #persistAuth(): Promise<void> {
    await writeFile(join(this.#dataDir, "auth.json"), JSON.stringify({ sessdata: this.#sessdata ?? "" }, null, 2), "utf8");
  }

  /** 重启后从 auth.json 还原登录态（幂等；在 init 时调用） */
  async #loadAuth(): Promise<void> {
    try {
      const raw = await readFile(join(this.#dataDir, "auth.json"), "utf8");
      const parsed = JSON.parse(raw) as { sessdata?: string };
      if (parsed.sessdata) {
        this.#sessdata = parsed.sessdata;
        this.#http.jar.set("SESSDATA", parsed.sessdata);
      }
    } catch {
      // 无 auth.json / 解析失败：保持未登录
    }
  }

  // ---------- 解析会话 ----------

  async parseUrls(urls: string[]): Promise<ParseResult[]> {
    // 桌面在启动时初始化匿名指纹 cookie（CookieManager.init_cookie_info），
    // Web 侧在首次解析前补齐同一套 cookie，降低 WBI 接口 412 概率
    await this.#sessionReady;
    const results: ParseResult[] = [];
    for (const raw of urls) {
      const url = raw.trim();
      if (!url) continue;
      const result = await parseUrl(this.ctx, url);
      for (const item of result.items) {
        if (!this.#items.has(item.id)) {
          this.#items.set(item.id, item);
        }
      }
      this.#store.addParseHistory({
        url,
        title: result.title ?? "",
        type: result.type,
        itemCount: result.items.length,
      });
      results.push(result);
    }
    return results;
  }

  /**
   * 统一解析入口：支持两种形态。
   * - 无 type：按 urls 逐一识别链接（行为与 parseUrls 一致）。
   * - 有 type：按类型入口构造内部 URL（space/favlist/watch_later/history/popular 等），
   *   让前端"选类型 + 填输入"的交互成为真功能（对应桌面 ParserType 各类型）。
   */
  async parseRequest(req: ParseRequest): Promise<ParseResult[]> {
    await this.#sessionReady;
    if (!req.type) {
      return this.parseUrls(req.urls ?? []);
    }
    const urls = await this.#buildUrlsForType(req);
    if (urls.length === 0) {
      throw new BiliError("INVALID_URL", "请输入有效的链接或用户名");
    }

    // 分页类型（space/favlist/history/watch_later/list）：按 pn 起始、pages 翻页聚合
    if (this.#isPaginatedType(req.type)) {
      const startPn = req.pn !== undefined && req.pn > 0 ? Math.floor(req.pn) : 1;
      const pages = req.pages !== undefined && req.pages > 0 ? Math.max(1, Math.floor(req.pages)) : 1;
      const results: ParseResult[] = [];
      for (const url of urls) {
        const merged = await this.#parsePagedUrl(url, startPn, pages);
        if (merged) results.push(merged);
      }
      return results;
    }

    return this.parseUrls(urls);
  }

  // ---------- 解析历史 ----------

  listParseHistory(): ParseHistoryEntry[] {
    return this.#store.listParseHistory();
  }

  deleteParseHistory(id: number): boolean {
    return this.#store.removeParseHistory(id);
  }

  /** 是否支持翻页的类型入口 */
  #isPaginatedType(type: string): boolean {
    return ["space", "favlist", "history", "watch_later", "list"].includes(type);
  }

  /** 逐页解析并聚合为一个 ParseResult（含去重注册到内存条目表） */
  async #parsePagedUrl(
    url: string,
    startPn: number,
    pages: number,
  ): Promise<ParseResult | undefined> {
    let first: ParseResult | undefined;
    const items: MediaItem[] = [];
    let pagination: ParseResult["pagination"];
    for (let page = startPn; page < startPn + pages; page += 1) {
      const result = await parseUrl(this.ctx, url, { pn: page });
      for (const item of result.items) {
        if (!this.#items.has(item.id)) this.#items.set(item.id, item);
        items.push(item);
      }
      if (!first) first = result;
      if (result.pagination) pagination = result.pagination;
      // 已到达最后一页则提前结束（避免请求不存在的页）
      if (result.pagination && page >= result.pagination.totalPages) break;
    }
    if (!first) return undefined;
    this.#store.addParseHistory({
      url,
      title: first.title ?? "",
      type: first.type,
      itemCount: items.length,
    });
    return {
      type: first.type,
      items,
      ...(first.title !== undefined ? { title: first.title } : {}),
      ...(first.redirectUrl !== undefined ? { redirectUrl: first.redirectUrl } : {}),
      ...(pagination !== undefined ? { pagination } : {}),
    };
  }

  /** 根据类型入口构造需要交给 parseUrl 的 URL 列表 */
  async #buildUrlsForType(req: ParseRequest): Promise<string[]> {
    const query = (req.query ?? "").trim();
    const keyword = (req.keyword ?? "").trim();
    switch (req.type) {
      case "video":
      case "bangumi":
      case "cheese":
      case "lesson":
      case "audio":
      case "favlist":
      case "list":
        // 这些类型直接接受链接（可多行/逗号分隔）
        return query
          .split(/\r?\n|,|;/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
      case "space": {
        const target = await this.#resolveSpaceTarget(query);
        const qs = keyword ? `?keyword=${encodeURIComponent(keyword)}` : "";
        return [`https://space.bilibili.com/${target}${qs}`];
      }
      case "popular": {
        const num = req.weekNum ?? 1;
        return [`https://www.bilibili.com/v/popular/weekly?num=${num}`];
      }
      case "watch_later": {
        const qs = keyword ? `?key=${encodeURIComponent(keyword)}` : "";
        return [`bili23://watch_later${qs}`];
      }
      case "history": {
        const qs = keyword ? `?keyword=${encodeURIComponent(keyword)}` : "";
        return [`bili23://history${qs}`];
      }
      default:
        throw new BiliError("UNSUPPORTED_TYPE", `暂不支持的类型入口：${req.type}`);
    }
  }

  /** 解析空间输入：数字 UID / 已是 space 链接 / 用户名（WBI 搜索用户解析 mid） */
  async #resolveSpaceTarget(query: string): Promise<string> {
    const q = query.trim();
    if (!q) throw new BiliError("INVALID_URL", "请输入 UP 主 UID 或用户名");
    if (/^\d+$/.test(q)) return q;
    const { type, token } = classifyUrl(q);
    if (type === "space" && token) return token;
    const name = q.replace(/^https?:\/\//, "").replace(/^space\.bilibili\.com\//, "");
    const mid = await this.#midFromUsername(type === "space" ? "" : name);
    return String(mid);
  }

  /** 通过 B 站用户搜索接口把用户名解析为 mid（优先精确匹配，否则取首个结果） */
  async #midFromUsername(name: string): Promise<number> {
    const keyword = (name || "").trim();
    if (!keyword) throw new BiliError("INVALID_URL", "请输入 UP 主用户名");
    const body = await this.#http.getJSON<{
      code: number;
      message?: string;
      data?: { result?: Array<{ mid?: number; uname?: string }> };
    }>(`${BILI_API_BASE}/x/web-interface/search/type`, {
      params: { search_type: "bili_user", keyword },
    });
    if (body.code !== 0) {
      throw new BiliError("API_ERROR", body.message ?? "搜索用户失败", { apiCode: body.code });
    }
    const users = body.data?.result ?? [];
    const exact = users.find((u) => u.uname?.trim() === keyword || u.uname?.trim().toLowerCase() === keyword.toLowerCase());
    const target = exact ?? users[0];
    if (!target?.mid) {
      throw new BiliError("INVALID_URL", `未找到名为“${keyword}”的 UP 主，请确认用户名或改用数字 UID`);
    }
    return target.mid;
  }

  getMedia(itemId: string): MediaItem | undefined {
    return this.#items.get(itemId);
  }

  /** 拉取某个条目的可选画质/编码/音质（下载选项弹层用） */
  async mediaOptions(itemId: string): Promise<MediaOptionSummary> {
    const item = this.#items.get(itemId);
    if (!item) throw new BiliError("INVALID_URL", `条目不存在：${itemId}`);
    const info = await fetchPlayMediaInfo(this.ctx, item);
    const qualities: MediaOptionSummary["qualities"] = [];
    const seen = new Set<number>();
    for (const q of info.qualities) {
      seen.add(q);
      const byCodec = info.videoByQuality[q];
      const codecs = byCodec
        ? Object.keys(byCodec)
            .map(Number)
            .map((id) => ({ id, label: codecLabel(id) }))
        : [];
      qualities.push({ id: q, label: videoQualityLabel(q), codecs });
    }
    // 单文件/MP4 直链形态（audio=m4a 192K、lesson=mp4 1080P、durl 视频）没有 DASH qualities，
    // 把接口返回的 mp4Qualities 补进选项，避免下拉只剩"自动"（Task 2.9 顺手修复）
    if (info.mediaType === "mp4" || info.singleFileExt) {
      for (const q of info.mp4Qualities) {
        if (seen.has(q)) continue;
        seen.add(q);
        qualities.push({ id: q, label: info.mp4QualityLabel[q] ?? String(q), codecs: [] });
      }
    }
    return {
      itemId,
      mediaType: info.mediaType,
      timelength: info.timelength,
      qualities,
      audioQualities: info.audioQualities.map((id) => ({ id, label: audioQualityLabel(id) })),
    };
  }

  // ---------- 任务 ----------

  listTasks(): TaskSummary[] {
    return [...this.#tasks.values()].map((t) => t.summary());
  }

  getTask(id: string): TaskSummary | undefined {
    return this.#tasks.get(id)?.summary();
  }

  subscribeTask(id: string, listener: Listener): (() => void) | undefined {
    const task = this.#tasks.get(id);
    return task ? task.subscribe(listener) : undefined;
  }

  /**
   * 创建下载任务。重复检测：任一条目已存在于进行中/历史则返回 duplicate 提示，
   * force=true 时继续创建（对齐桌面重复下载策略的“继续”）。
   */
  async createTasks(
    itemIds: string[],
    options: DownloadOptions,
    force = false,
  ): Promise<{ tasks: TaskSummary[]; duplicates: Array<{ itemId: string; title: string }> }> {
    const items: Array<{ item: MediaItem; hash: string }> = [];
    const duplicates: Array<{ itemId: string; title: string }> = [];
    for (const itemId of itemIds) {
      const item = this.#items.get(itemId);
      if (!item) throw new BiliError("INVALID_URL", "条目不存在：" + itemId);
      const hash = this.#hashOf(item);
      if (!force && this.#store.checkDuplicate(hash)) {
        duplicates.push({ itemId, title: item.title });
        continue;
      }
      items.push({ item, hash });
    }
    if (duplicates.length > 0 && items.length === 0) {
      return { tasks: [], duplicates };
    }

    const created: ManagedTask[] = [];
    const cfg = await this.#configReady.then(() => this.#configStore.get());
    // 新任务创建时刷新运行时并发/限速（决策 2：调度器上限实时更新）
    this.#applyRuntimeConfig(cfg);
    const numberingType = cfg.fileNaming.numberingType;
    // USE_PARSE_LIST：序号 = 本次勾选条目在批量创建时的顺序（1 起），见 P3 计划差异记录
    const allocator = new NumberingAllocator(numberingType as NumberingTypeId, cfg.fileNaming.startingNumber);
    for (const [index, entry] of items.entries()) {
      const { item, hash } = entry;
      const conventionType = resolveConventionType(item);
      const rule =
        this.#findRule(cfg.fileNaming.rules, conventionType)?.rule ??
        this.#findRule(DEFAULT_NAMING_RULES, conventionType)?.rule ??
        "{leaf_title}";
      const number = allocator.alloc(numberingType === 1 ? index + 1 : undefined);
      const resolved: DownloadOptions = {
        ...options,
        extras: deepMerge(cfg.additional, options.extras),
        naming: { conventionType, rule, number },
      };
      const task = new ManagedTask(item, resolved);
      task.duplicate = duplicates.some((d) => d.itemId === item.id);
      this.#tasks.set(task.id, task);
      // 进入等待队列：先持久化 queued，再由调度器按并发上限启动
      this.#persist(task, { status: "queued" });
      task.pushLog("已加入队列，等待调度");
      created.push(task);
      this.#pending.push(task);
    }
    this.#scheduleNext();
    return { tasks: created.map((t) => t.summary()), duplicates };
  }

  /** 取消（中止下载/合并；queued 任务直接从队列移除） */
  cancelTask(id: string): void {
    const task = this.#tasks.get(id);
    if (!task) return;
    if (task.status === "queued") {
      this.#removePending(task);
      task.update({ status: "cancelled" });
      this.#store.removeActive(id);
      task.pushLog("已取消");
      return;
    }
    task.cancel();
  }

  /** 暂停：仅 queued/parsing/downloading/merging 可暂停；任务不存在或状态非法返回 undefined */
  pauseTask(id: string): TaskSummary | undefined {
    const task = this.#tasks.get(id);
    if (!task) return undefined;
    if (task.status === "queued") {
      this.#removePending(task);
      task.pushLog("已暂停（等待中）");
      task.update({ status: "paused" });
      this.#persist(task, { status: "paused" });
      return task.summary();
    }
    if (!RUNNING_STATUSES.has(task.status)) return undefined;
    task.pushLog("收到暂停请求，正在中止…");
    task.pause(); // #run 收尾时按 paused 保留断点与临时文件
    return task.summary();
  }

  /** 继续：paused/interrupted/failed/cancelled → 复用断点续传 */
  resumeTask(id: string): TaskSummary | undefined {
    const task = this.#tasks.get(id);
    if (!task) return undefined;
    if (
      task.status !== "paused" &&
      task.status !== "interrupted" &&
      task.status !== "failed" &&
      task.status !== "cancelled"
    ) {
      return undefined;
    }
    task.resetForRun();
    task.error = undefined;
    task.pushLog("继续下载（断点续传）");
    task.update({ status: "queued" });
    this.#pending.push(task);
    this.#scheduleNext();
    return task.summary();
  }

  /** 重试：failed/cancelled → 清空断点、重建 download_task 行后全新下载（不续传） */
  retryTask(id: string): TaskSummary | undefined {
    const task = this.#tasks.get(id);
    if (!task) return undefined;
    if (task.status !== "failed" && task.status !== "cancelled") return undefined;
    task.resetForRun();
    task.files = {};
    task.error = undefined;
    task.outputPath = undefined;
    task.startedAt = undefined;
    task.progress = 0;
    task.downloadedBytes = 0;
    task.totalBytes = 0;
    this.#store.removeActive(id);
    task.update({ status: "queued" });
    this.#persist(task, { status: "queued", files: {} });
    task.pushLog("重试：清空断点，重新下载");
    this.#pending.push(task);
    this.#scheduleNext();
    return task.summary();
  }

  /**
   * 删除任务：移除内存任务 + download_task/completed_task 行 + 清理 .tmp/<id> 目录。
   * 运行中的任务先中止并等 #run 收尾（句柄关闭）再删目录；不存在返回 false。
   */
  async deleteTask(id: string): Promise<boolean> {
    const task = this.#tasks.get(id);
    const hasActive = this.#store.getActive(id) !== null;
    const hasCompleted = this.#store.getCompleted(id) !== null;
    if (!task && !hasActive && !hasCompleted) return false;

    if (task) {
      if (task.status === "queued") {
        this.#removePending(task);
      } else if (RUNNING_STATUSES.has(task.status)) {
        // 中止运行中的下载/合并，等待收尾后再清理目录（避免文件句柄未关）
        task.cancel();
        await task.runPromise?.catch(() => undefined);
      }
      task.pushLog("任务已删除");
      this.#tasks.delete(id);
    }
    this.#store.removeActive(id);
    if (hasCompleted) this.#store.removeCompleted(id);
    const taskDir = join(this.#tmpDir, id);
    await rm(taskDir, { recursive: true, force: true }).catch(() => undefined);
    return true;
  }

  // ---------- 历史 / 日志 / 产物下载 ----------

  /** 已完成历史（completed_task 表，含重启前完成项；时间倒序） */
  listHistory(): HistoryEntryDto[] {
    return this.#store.listCompleted().map((rec) => {
      const data = (rec.data ?? {}) as Partial<TaskSnapshot> & {
        outputPath?: string | undefined;
        error?: string | undefined;
      };
      const entry: HistoryEntryDto = {
        taskId: rec.taskId,
        title: rec.title,
        completedAt: rec.time,
      };
      if (typeof data.outputPath === "string") entry.outputPath = data.outputPath;
      if (typeof data.error === "string") entry.error = data.error;
      return entry;
    });
  }

  /** 删除历史记录：移除 completed_task 行与内存已完成任务（不动产物文件） */
  deleteHistory(taskId: string): boolean {
    const task = this.#tasks.get(taskId);
    const rec = this.#store.getCompleted(taskId);
    if (!rec && !(task && task.status === "completed")) return false;
    if (rec) this.#store.removeCompleted(taskId);
    if (task) {
      task.pushLog("历史记录已删除");
      this.#tasks.delete(taskId);
    }
    return true;
  }

  /** 任务生命周期日志（内存环形，≤200 行）；不存在返回 undefined */
  taskLog(id: string): string[] | undefined {
    return this.#tasks.get(id)?.logLines();
  }

  /** 下载根目录（产物/临时文件均位于其下） */
  downloadRootDir(): string {
    return this.#rootDir;
  }

  /** 规范化下载根内相对路径并防目录穿越；越界/非法返回 undefined */
  resolveDownloadFile(relPath: string): string | undefined {
    return resolveDownloadPath(this.#rootDir, relPath);
  }

  /** 产物目录浏览（不含 .tmp 临时目录） */
  async listFiles(): Promise<FileEntry[]> {
    return this.#walk(this.#rootDir);
  }

  // ---------- 队列调度 / 重启恢复 ----------

  /** 调度：活动数 < 上限时按 FIFO 启动 queued 任务；终态（含 fail/cancel/pause）后都会再次调用 */
  #scheduleNext(): void {
    while (this.#activeCount() < this.#maxParallel) {
      const task = this.#pending.shift();
      if (!task) return;
      if (task.status !== "queued") continue; // 已取消/删除的残留，跳过
      task.runPromise = this.#run(task);
      void task.runPromise.catch(() => undefined);
    }
  }

  /** 活动任务数（parsing/downloading/merging 占用并发槽位） */
  #activeCount(): number {
    let n = 0;
    for (const t of this.#tasks.values()) {
      if (RUNNING_STATUSES.has(t.status)) n += 1;
    }
    return n;
  }

  /** 从等待队列移除（暂停/取消/删除 queued 任务时） */
  #removePending(task: ManagedTask): void {
    const idx = this.#pending.indexOf(task);
    if (idx >= 0) this.#pending.splice(idx, 1);
  }

  /** 用最新配置刷新运行时并发/限速/代理/CDN/ffmpeg（创建任务与配置变更时调用） */
  #applyRuntimeConfig(cfg: AppConfig): void {
    this.#gate.setBps(cfg.download.speedLimitKbps * 1024);
    this.#maxParallel = cfg.download.parallel;
    this.#maxThreads = cfg.download.threads;
    // advanced：代理、CDN、ffmpeg 路径即时生效
    this.#http.setProxy(cfg.advanced.proxy);
    this.#cdnHosts = cfg.advanced.cdnHosts;
    this.#ffmpegPath = cfg.advanced.ffmpegPath;
  }

  /** 重启恢复实现（见 init）：download_task 遗留任务一律置 interrupted，保留断点可手动继续 */
  async #rehydrate(): Promise<void> {
    await this.#configReady;
    const rows = this.#store.listActive();
    for (const rec of rows) {
      const data = rec.data as Partial<TaskSnapshot> | null;
      if (!data || typeof data !== "object") continue;
      if (!data.item || !data.options) continue;
      const task = new ManagedTask(data.item, data.options, rec.taskId);
      // 写回断点快照（续传用），保留 .tmp/.part；状态一律 interrupted
      task.files = data.files && typeof data.files === "object" ? data.files : {};
      task.status = "interrupted";
      task.error = "服务重启，任务中断，可点击继续";
      task.createdAt = rec.time;
      task.updatedAt = Math.floor(Date.now() / 1000);
      task.pushLog("服务重启，任务中断（保留断点，可点击继续）");
      this.#tasks.set(task.id, task);
      if (!this.#items.has(task.item.id)) this.#items.set(task.item.id, task.item);
      this.#persist(task, { status: "interrupted", files: task.files });
    }
  }

  // ---------- 内部执行 ----------

  async #run(task: ManagedTask): Promise<void> {
    // 速率估算：滑动窗口（最近 ~5s 样本）计算 bytes/s 与剩余秒数
    let speedSamples: Array<{ t: number; bytes: number }> = [];
    const updateSpeed = (bytes: number, total: number): void => {
      const now = Date.now();
      speedSamples.push({ t: now, bytes });
      while (speedSamples.length > 1 && now - (speedSamples[0]?.t ?? now) > 5000) {
        speedSamples.shift();
      }
      let bps = 0;
      if (speedSamples.length >= 2) {
        const first = speedSamples[0];
        const last = speedSamples[speedSamples.length - 1];
        if (first && last) {
          const dtMs = last.t - first.t;
          const delta = last.bytes - first.bytes;
          if (dtMs >= 200 && delta > 0) bps = Math.round((delta * 1000) / dtMs);
        }
      }
      task.speedBps = bps;
      task.etaSec = bps > 0 ? Math.max(0, Math.round((total - bytes) / bps)) : 0;
    };
    try {
      if (task.startedAt === undefined) task.startedAt = Math.floor(Date.now() / 1000);
      task.pushLog("开始解析视频信息");
      task.update({ status: "parsing" });
      this.#persist(task, { status: "parsing" });
      const info = await fetchPlayMediaInfo(this.ctx, task.item);
      const streamOpts: StreamOptions = {};
      if (task.options.videoQualityId !== undefined) streamOpts.videoQualityId = task.options.videoQualityId;
      if (task.options.videoCodecId !== undefined) streamOpts.videoCodecId = task.options.videoCodecId;
      if (task.options.audioQualityId !== undefined) streamOpts.audioQualityId = task.options.audioQualityId;
      const resolved = resolveStreams(info, streamOpts);
      const { files, mergePlan } = this.#buildPlan(task, info, resolved);
      if (files.length === 0) {
        throw new BiliError("DOWNLOAD_FAILED", "没有可下载的媒体流");
      }

      const taskDir = join(this.#tmpDir, task.id);
      await mkdir(taskDir, { recursive: true });

      // 先探测全部文件：取得可用地址与真实大小（对齐桌面解析阶段 resolve_download_url）
      task.update({ status: "downloading", progress: 0, downloadedBytes: 0 });
      const probed = await this.#probeFiles(files, taskDir, task.signal);
      const totalBytes = probed.reduce((sum, f) => sum + f.fileSize, 0);
      task.update({ totalBytes });
      this.#persist(task, { status: "downloading" });

      // 断点续传：优先用内存断点（init 恢复/暂停/取消时保留），其次读取库中快照
      const stored = this.#storedSnapshot(task.id);
      const resumeMap = Object.keys(task.files).length > 0 ? task.files : (stored?.files ?? {});
      let doneBytes = 0;

      for (const pf of probed) {
        if (task.aborted) throw new DownloadAbortedError();
        const destPath = join(taskDir, pf.fileName);
        const snapshot = resumeMap[pf.key];
        task.pushLog("下载文件 " + pf.fileName);
        await downloadFile({
          http: this.#http,
          url: pf.url,
          destPath,
          fileSize: pf.fileSize,
          referer: "https://www.bilibili.com/",
          concurrency: this.#maxThreads,
          signal: task.signal,
          gate: this.#gate,
          ...(snapshot ? { state: snapshot } : {}),
          onProgress: (p) => {
            const others = doneBytes;
            const partial = Math.min(p.downloadedBytes, pf.fileSize);
            const downloaded = others + partial;
            updateSpeed(downloaded, totalBytes);
            task.update({
              downloadedBytes: downloaded,
              progress: totalBytes > 0 ? (downloaded / totalBytes) * 100 : 0,
            });
          },
          onSnapshot: (s) => {
            resumeMap[pf.key] = s;
            this.#persistFiles(task, resumeMap);
          },
        });
        doneBytes += pf.fileSize;
        task.update({
          downloadedBytes: doneBytes,
          progress: totalBytes > 0 ? (doneBytes / totalBytes) * 100 : 0,
        });
      }

      // 命名目标 + 附加内容（弹幕/字幕/封面/章节先取回；embed 源写入 taskDir 供 ffmpeg 内嵌）
      const container = task.options.container ?? "mp4";
      // audio(m4a)/lesson(mp4) 属单文件直链：下载件即成品，仅改名不再过 ffmpeg；
      // 输出扩展名以接口语义为准，忽略用户容器选择（桌面同样保持 m4a/mp4 直出）
      const outExt = info.singleFileExt ?? container;
      const tempOut = join(taskDir, "output_" + task.id + "." + outExt);
      const labels = this.#qualityLabels(resolved);
      const target = this.#outputTarget(task, labels);
      const extrasOpt = task.options.extras ?? DEFAULT_EXTRAS_OPTIONS;
      const gathered = await this.#gatherExtraInputs(task, taskDir, info, extrasOpt, container);

      // 合并/转封装（附加内容随 ffmpeg 一并内嵌）
      task.pushLog("开始合并/转封装（" + outExt + "）");
      task.update({ status: "merging" });
      this.#persist(task, { status: "merging" });
      if (info.singleFileExt) {
        const part = files[0];
        if (!part) throw new BiliError("DOWNLOAD_FAILED", "缺少单文件直链");
        await rename(join(taskDir, part.fileName), tempOut);
      } else {
        await this.#merge(task, taskDir, mergePlan, files, tempOut, container, gathered.merge);
      }

      // 落盘到最终目录（按命名规则 folder/stem，冲突自动改名）
      const finalPath = await this.#placeOutput(task, tempOut, target.dir, target.stem, outExt);
      await probeMedia(finalPath); // 校验产物可读（ffprobe）
      await this.#writeStandaloneExtras(task, finalPath, extrasOpt, gathered);
      task.update({ status: "completed", progress: 100, outputPath: finalPath });
      task.speedBps = 0;
      task.etaSec = 0;
      task.pushLog("下载完成：" + finalPath);
      await rm(taskDir, { recursive: true, force: true });

      const completedData = {
        ...this.#storedSnapshot(task.id),
        status: "completed",
        outputPath: finalPath,
        qualityLabel: task.summary().qualityLabel,
      };
      this.#store.removeActive(task.id);
      const hash = this.#hashOf(task.item);
      this.#store.addCompleted({
        taskId: task.id,
        hashId: hash,
        title: task.item.title,
        data: completedData,
      });
      this.#scheduleNext();
    } catch (err) {
      // 用户中止（暂停/取消/删除）：按意图区分；暂停保留断点与 download_task 行
      if (task.aborted || err instanceof DownloadAbortedError) {
        const lastSnap = this.#storedSnapshot(task.id);
        if (lastSnap && lastSnap.files) task.files = lastSnap.files;
        if (task.requestedState === "paused") {
          task.update({ status: "paused" });
          this.#persist(task, { status: "paused", files: task.files });
          task.pushLog("已暂停（断点已保留，可点击继续）");
        } else {
          task.update({ status: "cancelled", error: undefined });
          this.#store.removeActive(task.id);
          task.pushLog("已取消");
        }
        this.#scheduleNext();
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      task.update({ status: "failed", error: message });
      this.#persist(task, { status: "failed" });
      task.pushLog("失败：" + message);
      this.#scheduleNext();
    }
  }

  /** 取流候选地址：优先用用户 CDN 主机重写，原始 B 站调度链接兜底（去重） */
  #candidateUrls(candidates: string[]): string[] {
    const base = candidates.filter((u) => typeof u === "string" && u.length > 0);
    if (this.#cdnHosts.length === 0 || base.length === 0) {
      return [...new Set(base)];
    }
    const out: string[] = [];
    for (const url of base) {
      for (const host of this.#cdnHosts) {
        const rewritten = this.#rewriteHost(url, host);
        if (rewritten && !out.includes(rewritten)) out.push(rewritten);
      }
    }
    for (const url of base) if (!out.includes(url)) out.push(url);
    return out;
  }

  /** 把 URL 的 host 替换为给定 CDN 主机（host 可带协议/路径，只取 host 部分）；非法返回 undefined */
  #rewriteHost(url: string, host: string): string | undefined {
    try {
      const u = new URL(url);
      const rawHost = host.includes("://") ? new URL(host).host : host;
      if (!rawHost) return undefined;
      u.host = rawHost;
      return u.toString();
    } catch {
      return undefined;
    }
  }

  #buildPlan(
    task: ManagedTask,
    info: VideoMediaInfo,
    resolved: ResolvedStreams,
  ): { files: PlannedFile[]; mergePlan: MergePlan } {
    const files: PlannedFile[] = [];
    if (resolved.mediaType === "dash" && resolved.videoRef) {
      const videoFile: PlannedFile = {
        key: "video",
        urls: this.#candidateUrls([resolved.videoRef.baseUrl, ...resolved.videoRef.backupUrl]),
        fileName: `video_${task.id}.m4s`,
      };
      files.push(videoFile);
      const mergePlan: MergePlan = { kind: "dash", videoKey: "video", partKeys: [] };
      if (resolved.audioRef) {
        files.push({
          key: "audio",
          urls: this.#candidateUrls([resolved.audioRef.baseUrl, ...resolved.audioRef.backupUrl]),
          fileName: `audio_${task.id}.m4s`,
        });
        mergePlan.audioKey = "audio";
      }
      return { files, mergePlan };
    }
    // MP4/FLV 直链分片
    const durl = resolved.durl ?? [];
    const mergePlan: MergePlan = { kind: "parts", videoKey: "video_part_0", partKeys: [] };
    for (const part of durl) {
      const key = `video_part_${part.order}`;
      mergePlan.partKeys.push(key);
      files.push({
        key,
        urls: this.#candidateUrls([part.url, ...part.backupUrl]),
        fileName: `video_${task.id}_${part.order}.mp4`,
      });
    }
    return { files, mergePlan };
  }

  async #probeFiles(
    files: PlannedFile[],
    taskDir: string,
    signal: AbortSignal,
  ): Promise<Array<{ key: string; fileName: string; url: string; fileSize: number }>> {
    const result: Array<{ key: string; fileName: string; url: string; fileSize: number }> = [];
    for (const file of files) {
      if (signal.aborted) throw new DownloadAbortedError();
      const probe = await probeStreamUrl(this.#http, file.urls, { signal });
      result.push({ key: file.key, fileName: file.fileName, url: probe.url, fileSize: probe.fileSize });
    }
    return result;
  }

  async #merge(
    task: ManagedTask,
    taskDir: string,
    plan: MergePlan,
    files: PlannedFile[],
    tempOut: string,
    container: "mp4" | "mkv",
    embed?: { subtitleTracks?: SubtitleTrackSpec[]; coverPath?: string; chapterPath?: string },
  ): Promise<void> {
    const byKey = new Map(files.map((f) => [f.key, f]));
    if (plan.kind === "dash") {
      const video = byKey.get(plan.videoKey);
      const audio = plan.audioKey ? byKey.get(plan.audioKey) : undefined;
      if (!video) throw new BiliError("DOWNLOAD_FAILED", "缺少视频文件");
      const videoPath = join(taskDir, video.fileName);
      const audioPath = audio ? join(taskDir, audio.fileName) : undefined;
      if (audioPath) {
        await mergeAudioVideo(videoPath, audioPath, tempOut, {
          container,
          signal: task.signal,
          cwd: taskDir,
          ...(this.#ffmpegPath !== undefined ? { ffmpegPath: this.#ffmpegPath } : {}),
          ...embed,
        });
      } else {
        await remuxMedia(videoPath, tempOut, {
          container,
          signal: task.signal,
          ...(this.#ffmpegPath !== undefined ? { ffmpegPath: this.#ffmpegPath } : {}),
        });
      }
      return;
    }
    // 分片合并：concat demuxer（相对路径 + cwd=taskDir）
    const listPath = join(taskDir, "concat.list");
    const lines = plan.partKeys
      .map((key) => byKey.get(key)?.fileName)
      .filter((n): n is string => Boolean(n))
      .map((n) => `file '${n.replace(/'/g, "'\\''")}'`);
    await writeFile(listPath, lines.join("\n") + "\n", "utf8");
    await concatMediaParts(listPath, tempOut, {
      container,
      signal: task.signal,
      cwd: taskDir,
      ...(this.#ffmpegPath !== undefined ? { ffmpegPath: this.#ffmpegPath } : {}),
      ...embed,
    });
  }

  async #placeOutput(
    task: ManagedTask,
    tempOut: string,
    dir: string,
    stem: string,
    ext: string,
  ): Promise<string> {
    await mkdir(dir, { recursive: true });
    const unique = await this.#uniquePath(join(dir, `${stem}.${ext}`));
    await rename(tempOut, unique);
    return unique;
  }

  // ---------- P3：命名与附加内容管线 ----------

  /** 从命名规则列表取指定分类的规则（默认优先） */
  #findRule(rules: NamingRule[], type: number): NamingRule | undefined {
    return rules.find((r) => r.type === type && r.default === true) ?? rules.find((r) => r.type === type);
  }

  /** 档位展示标签（命名变量 video_quality/audio_quality/video_codec） */
  #qualityLabels(resolved: ResolvedStreams): NamingQuality {
    return {
      videoQuality: videoQualityLabel(resolved.videoQualityId),
      audioQuality: resolved.audioQualityId > 0 ? audioQualityLabel(resolved.audioQualityId) : "",
      videoCodec: resolved.audioQualityId > 0 ? (VIDEO_CODEC_STR[resolved.videoCodecId] ?? "") : "",
    };
  }

  /** 由命名快照算出最终输出目标（dir 目录 + stem 主名，不含扩展名） */
  #outputTarget(task: ManagedTask, labels: NamingQuality): { dir: string; stem: string } {
    const naming = task.options.naming;
    const rule = naming && naming.rule.length > 0 ? naming.rule : "{leaf_title}";
    const vars = buildNamingVariables(task.item, labels, naming?.number ?? "", task.createdAt);
    const rel = formatFileName(rule, vars);
    const idx = Math.max(rel.lastIndexOf("/"), rel.lastIndexOf("\\"));
    const folder = idx >= 0 ? rel.slice(0, idx) : "";
    const stem = idx >= 0 ? rel.slice(idx + 1) : rel;
    return { dir: folder ? join(this.#rootDir, folder) : this.#rootDir, stem };
  }

  /** 弹幕/字幕正文转换（按所选格式） */
  #convertSubtitleText(data: SubtitleJson, format: SubtitleFormat, style: SubtitleStyle): string {
    switch (format) {
      case "srt":
        return toSubtitleSrt(data);
      case "lrc":
        return toSubtitleLrc(data);
      case "txt":
        return toSubtitleTxt(data);
      case "json":
        return toSubtitleJson(data);
      case "ass":
      default:
        return toSubtitleAss(data, "subtitle", style);
    }
  }

  /**
   * 取回附加内容：写 embed 源文件到 taskDir，返回合并内嵌参数与待落盘的独立文件内容。
   * 弹幕/字幕仅 cid 类型（video/bangumi/cheese）可用；元数据与封面视条目字段而定。
   */
  async #gatherExtraInputs(
    task: ManagedTask,
    taskDir: string,
    info: VideoMediaInfo,
    opts: ExtrasOptions,
    container: "mp4" | "mkv",
  ): Promise<GatheredExtras> {
    const item = task.item;
    const cid = item.cid;
    const hasMerge = !info.singleFileExt;
    const canEmbedAss = hasMerge && container === "mkv";
    const merge: NonNullable<GatheredExtras["merge"]> = {};
    const out: GatheredExtras = {};
    let playerInfo: PlayerInfo | undefined;

    // 弹幕
    if (opts.danmaku?.enabled && cid !== undefined) {
      const xml = await fetchDanmakuXml(this.ctx, cid);
      const entries = parseDanmakuXml(xml);
      const format = opts.danmaku.format;
      let contents: string;
      if (format === "xml") contents = danmakuToXml(entries, cid);
      else if (format === "json") contents = danmakuToJson(entries);
      else contents = danmakuToAss(entries, item.groupTitle || item.title, opts.danmaku.style);
      let skipFile = false;
      if (format === "ass" && opts.danmaku.embed === true && canEmbedAss) {
        const file = "embed-danmaku.ass";
        await writeFile(join(taskDir, file), contents, "utf8");
        merge.subtitleTracks ??= [];
        merge.subtitleTracks.push({ file, title: "弹幕", kind: "danmaku" });
        skipFile = opts.danmaku.deleteAfterEmbed === true;
      }
      out.danmaku = { format, contents, skipFile };
    }

    // 字幕 + 章节：播放器信息（player/v2）一次请求
    const wantPlayer = (opts.subtitle?.enabled === true || opts.chapter?.embed === true) && cid !== undefined;
    if (wantPlayer) {
      playerInfo = await this.#fetchPlayerInfo(task);
    }
    if (opts.subtitle?.enabled && cid !== undefined) {
      const infos = playerInfo?.subtitle?.subtitles ?? [];
      const entries = await fetchSubtitlesData(this.ctx, infos, opts.subtitle.language);
      const format = opts.subtitle.format;
      const embed = format === "ass" && opts.subtitle.embed === true && canEmbedAss;
      const list: NonNullable<GatheredExtras["subtitles"]> = [];
      for (const [index, entry] of entries.entries()) {
        const contents = this.#convertSubtitleText(entry.data, format, opts.subtitle.style);
        let skipFile = false;
        if (embed) {
          const file = `embed-subtitle-${index}.ass`;
          await writeFile(join(taskDir, file), contents, "utf8");
          merge.subtitleTracks ??= [];
          {
            const lang = toIso639_2(entry.language);
            merge.subtitleTracks.push({
              file,
              title: subtitleTrackTitle(entry.language, entry.languageDoc),
              kind: "subtitle",
              ...(lang ? { language: lang } : {}),
            });
          }
          skipFile = opts.subtitle.deleteAfterEmbed === true;
        }
        list.push({
          format,
          language: entry.language,
          languageDoc: entry.languageDoc,
          contents,
          skipFile,
        });
      }
      out.subtitles = list;
    }

    // 章节（view_points → ffmetadata 中间文件）
    if (opts.chapter?.embed === true && hasMerge) {
      const points = playerInfo?.view_points;
      if (points && points.length > 0) {
        const fileName = chapterFileName(task.id);
        await writeFile(
          join(taskDir, fileName),
          buildChapterFfmetadata(points, item.duration || 0),
          "utf8",
        );
        merge.chapterPath = fileName;
      }
    }

    // 封面
    if (opts.cover?.enabled && item.cover) {
      const format = opts.cover.format;
      const bytes = await fetchCoverBytes(this.ctx, item.cover, format);
      let skipFile = false;
      const attach = opts.cover.attach === true && hasMerge && format !== "avif";
      if (attach) {
        const fileName = `cover.${format}`;
        await writeFile(join(taskDir, fileName), Buffer.from(bytes));
        merge.coverPath = fileName;
        skipFile = opts.cover.deleteAfterAttach === true;
      }
      out.cover = { format, bytes, skipFile };
    }

    if (Object.keys(merge).length > 0) out.merge = merge;
    return out;
  }

  /** 播放器信息（校验 cid 后用 {cid,bvid?,aid?} 调用，满足 exactOptionalPropertyTypes） */
  async #fetchPlayerInfo(task: ManagedTask): Promise<PlayerInfo> {
    const item = task.item;
    const cid = item.cid;
    if (cid === undefined) {
      throw new BiliError("INVALID_URL", "条目缺少 cid，无法获取播放器信息");
    }
    return fetchPlayerInfo(this.ctx, {
      cid,
      ...(item.bvid !== undefined ? { bvid: item.bvid } : {}),
      ...(item.aid !== undefined ? { aid: item.aid } : {}),
    });
  }

  /** 落盘独立附加文件（与主文件同目录/同 stem；embed 且删除的跳过） */
  async #writeStandaloneExtras(
    task: ManagedTask,
    finalPath: string,
    opts: ExtrasOptions,
    gathered: GatheredExtras,
  ): Promise<void> {
    const dir = dirname(finalPath);
    const base = basename(finalPath);
    const dot = base.lastIndexOf(".");
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const safe = (s: string): string => (s || "_").replace(/[\\/:*?"<>|\r\n\t]/g, "_").slice(0, 200);

    const tryWrite = async (label: string, run: () => Promise<void>): Promise<void> => {
      try {
        await run();
      } catch (err) {
        console.warn(`[bili23-web] 附加内容 ${label} 写入失败（不影响主文件）:`, err instanceof Error ? err.message : err);
      }
    };

    if (gathered.danmaku && !gathered.danmaku.skipFile) {
      await tryWrite("弹幕", () =>
        writeFile(join(dir, `${safe(stem)}.Danmaku.${gathered.danmaku!.format}`), gathered.danmaku!.contents, "utf8"),
      );
    }
    for (const sub of gathered.subtitles ?? []) {
      if (sub.skipFile) continue;
      await tryWrite("字幕", () =>
        writeFile(join(dir, `${safe(stem)}.Subtitles.${safe(sub.language)}.${sub.format}`), sub.contents, "utf8"),
      );
    }
    if (gathered.cover && !gathered.cover.skipFile) {
      await tryWrite("封面", () =>
        writeFile(join(dir, `${safe(stem)}.${gathered.cover!.format}`), Buffer.from(gathered.cover!.bytes)),
      );
    }

    // 元数据（NFO/JSON）
    if (opts.metadata?.enabled) {
      const item = task.item;
      const kind = item.type === "bangumi" || item.type === "cheese" || item.type === "lesson" ? item.type : "video";
      const input: MetadataInput = {
        kind,
        showTitle: item.title,
        description: item.desc,
        durationSec: item.duration,
        pubtime: item.pubtime,
        cover: item.cover,
        owner: item.owner,
        ...(item.bvid !== undefined ? { bvid: item.bvid } : {}),
        ...(item.seasonId !== undefined ? { seasonId: item.seasonId } : {}),
        ...(item.epId !== undefined ? { epId: item.epId } : {}),
        ...(item.episodeNumber !== undefined ? { episodeNumber: item.episodeNumber } : { episodeNumber: item.page }),
        ...(item.seasonTitle !== undefined ? { seasonTitle: item.seasonTitle } : {}),
      };
      if (kind === "video" && item.bvid) {
        try {
          input.tags = await fetchVideoTags(this.ctx, item.bvid);
        } catch {
          input.tags = [];
        }
      }
      if (opts.metadata.format === "nfo") {
        const includeTvshow = !existsSync(join(dir, "tvshow.nfo"));
        for (const output of buildMetadataNfo(input, safe(stem), includeTvshow)) {
          await tryWrite("NFO", () => {
            const suffix = output.qualifier.length > 0 ? `.${output.qualifier.join(".")}` : "";
            const name = output.name === "tvshow" ? "tvshow.nfo" : `${output.name}${suffix}.nfo`;
            return writeFile(join(dir, name), output.contents, "utf8");
          });
        }
      } else {
        await tryWrite("元数据 JSON", () =>
          writeFile(join(dir, `${safe(stem)}.Metadata.json`), buildMetadataJson(input), "utf8"),
        );
      }
    }
  }

  async #uniquePath(path: string): Promise<string> {
    const dir = path.slice(0, Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")));
    const base = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
    const dot = base.lastIndexOf(".");
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : "";
    let candidate = path;
    for (let i = 1; i < 1000; i += 1) {
      try {
        await stat(candidate);
        candidate = join(dir, `${stem} (${i})${ext}`);
      } catch {
        return candidate;
      }
    }
    return candidate;
  }

  async #walk(dir: string): Promise<FileEntry[]> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const out: FileEntry[] = [];
    for (const entry of entries) {
      if (entry.name === ".tmp") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...(await this.#walk(full)));
      } else {
        try {
          const s = await stat(full);
          out.push({ name: entry.name, path: relative(this.#rootDir, full).replace(/\\/g, "/"), size: s.size, mtime: Math.floor(s.mtimeMs / 1000) });
        } catch {
          // 文件被并发删除时跳过
        }
      }
    }
    return out;
  }

  #storedSnapshot(taskId: string): TaskSnapshot | undefined {
    const rec = this.#store.getActive(taskId);
    return rec ? (rec.data as TaskSnapshot) : undefined;
  }

  #persist(task: ManagedTask, patch: Partial<TaskSnapshot>): void {
    const current = this.#storedSnapshot(task.id);
    const data: TaskSnapshot = {
      item: task.item,
      options: task.options,
      status: task.status,
      files: current?.files ?? {},
      ...patch,
    };
    const hash = this.#hashOf(task.item);
    this.#store.upsertActive({ taskId: task.id, hashId: hash, title: task.item.title, data });
  }

  /** 条目 → 去重 hash（按类型只带该类型相关键，避免 exactOptionalPropertyTypes 报错） */
  #hashOf(item: MediaItem): string {
    return calcHashId({
      type: item.type,
      ...(item.aid !== undefined ? { aid: item.aid } : {}),
      ...(item.bvid !== undefined ? { bvid: item.bvid } : {}),
      ...(item.cid !== undefined ? { cid: item.cid } : {}),
      ...(item.epId !== undefined ? { epId: item.epId } : {}),
      ...(item.sid !== undefined ? { sid: item.sid } : {}),
      ...(item.courseId !== undefined ? { courseId: item.courseId } : {}),
      ...(item.lessonId !== undefined ? { lessonId: item.lessonId } : {}),
      ...(item.itemId !== undefined ? { itemId: item.itemId } : {}),
      ...(item.sectionId !== undefined ? { sectionId: item.sectionId } : {}),
    });
  }
  #persistFiles(task: ManagedTask, files: Record<string, ChunkState>): void {
    const current = this.#storedSnapshot(task.id);
    const data: TaskSnapshot = {
      item: task.item,
      options: task.options,
      status: task.status,
      files,
      ...(current?.status ? { status: current.status } : {}),
    };
    const hash = this.#hashOf(task.item);
    this.#store.upsertActive({ taskId: task.id, hashId: hash, title: task.item.title, data });
  }
}

