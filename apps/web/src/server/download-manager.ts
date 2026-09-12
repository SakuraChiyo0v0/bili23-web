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
  CookieJar,
  ensureAnonymousSession,
  qrGenerate,
  qrPoll,
  QRCodeStatus,
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
  runFfmpeg,
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
  DEFAULT_DANMAKU_STYLE,
  DEFAULT_SUBTITLE_STYLE,
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
import { ConfigStore, deepMerge, resolveCdnHosts, resolveProxyUrl } from "./config.js";
import { logger, logError, logInfo, logWarn } from "./logger.js";
import { friendlyDownloadError } from "./error-text.js";
import type { LogEntry } from "./logger.js";
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
  /** 是否下载视频流（缺省 true） */
  downloadVideo?: boolean;
  /**
   * **本次任务**的下载目录（原版下载选项弹窗页签3「下载设置 → 下载目录卡」，save=False）。
   * 只影响这一次任务，不写回全局配置；留空 = 用全局下载目录。
   */
  downloadDir?: string;
  /** 是否下载音频流（缺省 true） */
  downloadAudio?: boolean;
  /** 是否合并音视频（缺省 true；false 时视频流/音频流单独落盘） */
  mergeVideoAudio?: boolean;
  /** 合并后是否保留原始分片文件（缺省 false） */
  keepOriginalFiles?: boolean;
  /** 保留原始文件的类型：0 视频 / 1 音频 / 2 视频+音频（对齐桌面 keep_original_files_type） */
  keepOriginalFilesType?: number;
  /** 画质优先级（覆盖默认，从高到低） */
  videoQualityPriority?: number[];
  /** 编码优先级 */
  videoCodecPriority?: number[];
  /** 音质优先级 */
  audioQualityPriority?: number[];
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
  /** 封面 URL（B站缩略图） */
  cover?: string | undefined;
  /** 条目的原始链接（原版右键「重新解析」要用它重新走一次解析） */
  url?: string | undefined;
}

export interface MediaOptionSummary {
  itemId: string;
  mediaType: "dash" | "mp4";
  timelength: number;
  /** 可选画质（含该画质可用编码）；videoBandwidth 为该画质约合视频流码率(bps，0=未知) */
  qualities: Array<{
    id: number; label: string; codecs: Array<{ id: number; label: string }>; videoBandwidth: number;
    /** 帧率（playurl 的 frameRate，如 "60"）；拿不到就不给（原版媒体信息行会显示它） */
    frameRate?: string;
    width?: number; height?: number;
    /** MP4/durl 形态下接口给的真实字节数；DASH 没有这个字段（前端按码率×时长估算） */
    size?: number;
  }>;
  audioQualities: Array<{ id: number; label: string; audioBandwidth: number; audioCodecId?: number; audioCodecs?: string }>;
}

/** 代理连通性测试结果（`routes.ts` 转发给客户端；客户端 `services/types.ts` 有同名镜像） */
export interface ProxyTestResult {
  ok: boolean;
  ip?: string;
  location?: string;
  isp?: string;
  error?: string;
}

export type { LogEntry };

export interface FileEntry {
  name: string;
  /** 相对下载根目录的路径（正斜杠） */
  path: string;
  size: number;
  mtime: number;
}

/** 目录浏览条目：下载目录选择器用（只返回子目录，不含文件） */
export interface DirEntry {
  /** 目录名 */
  name: string;
  /** 完整绝对路径（供配置回填） */
  path: string;
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
/** 收藏夹封面缓存 TTL：成功 10 分钟；失败 1 分钟（412 之后别马上再打） */
const COVER_TTL_MS = 10 * 60 * 1000;
const COVER_FAIL_TTL_MS = 60 * 1000;

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

/**
 * 解析登录框粘贴的 Cookie 文本（UI 提示"支持分号或 JSON 格式"）：
 * - `SESSDATA=xxx; bili_jct=yyy` → 逐段解析（CookieJar.parse 会跳过 Path/Domain 等属性段）；
 * - `{"SESSDATA":"xxx"}`（对象映射）或 `[{"name":"SESSDATA","value":"xxx"}]`
 *   （Cookie-Editor / EditThisCookie 导出的数组）→ 按 JSON 解析；
 * - 裸值（只粘贴 SESSDATA 本身，如 `abc%2Cdef`）→ 整段当作 SESSDATA，保持旧行为。
 * 找不到 SESSDATA 时返回空表，由调用方给出明确报错（不再把整段原样存成 SESSDATA）。
 */
function parsePastedCookies(raw: string): Record<string, string> {
  const text = raw.trim();
  if (text.startsWith("{") || text.startsWith("[")) {
    const fromJson = cookiesFromJson(text);
    // JSON 本身合法但里面没有 SESSDATA 时，不再退化成"整段当裸值"，避免把 JSON 原文存成 SESSDATA
    if (fromJson) return fromJson.SESSDATA ? fromJson : {};
  }
  const jar = CookieJar.parse(text);
  if (jar.get("SESSDATA")) return jar.snapshot();
  // 完全没有 k=v 结构（不含 "="）时才按裸 SESSDATA 处理
  if (!text.includes("=")) return { SESSDATA: text };
  return {};
}

/** 把浏览器插件导出的 JSON 转成 name→value；非 JSON 或没有可用字段时返回 undefined */
function cookiesFromJson(text: string): Record<string, string> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const out: Record<string, string> = {};
  const put = (name: unknown, value: unknown): void => {
    if (typeof name === "string" && typeof value === "string" && value.length > 0) out[name] = value;
  };
  if (Array.isArray(parsed)) {
    for (const row of parsed) {
      if (!row || typeof row !== "object") continue;
      const r = row as { name?: unknown; value?: unknown };
      put(r.name, r.value);
    }
  } else if (parsed && typeof parsed === "object") {
    for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) put(name, value);
  }
  return Object.keys(out).length > 0 ? out : undefined;
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
      cover: this.item.cover || undefined,
      url: this.item.url || undefined,
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
  /**
   * 互动视频是否直接展开全部分支节点。
   *
   * 不传（默认）时 `/api/parse` 走"先探测"：命中互动视频只回报
   * `interactiveDetected`，让前端先弹「检测到互动视频，请选择操作」再带
   * `interactiveAll: true` 重来一次（对齐桌面两段式解析）。
   * `parseUrls` 被 MCP 直接调用时不传该字段 → 直接展开，保持原语义。
   */
  interactiveAll?: boolean;
}

export interface AuthStatus {
  loggedIn: boolean;
  /** 脱敏后的 SESSDATA 预览（如 "abc…1234"），便于 UI 提示已登录 */
  preview: string;
  /** 登录用户昵称（未登录/未取到为空） */
  uname?: string;
  /** 登录用户头像 URL（未登录/未取到为空） */
  face?: string;
  /** 登录用户 UID */
  mid?: number;
}

/** 扫码登录会话状态（QR 生成后轮询用） */
export interface QrLoginSession {
  /** 二维码内容（前端渲染为二维码图片） */
  qrUrl: string;
  /** 轮询 key */
  qrcodeKey: string;
  /** 当前扫码状态 */
  status: QRCodeStatus;
}

/** 附加内容样式兜底：前端可能传空 style，引擎需要完整 DanmakuStyle/SubtitleStyle 才能渲染 ASS */
export function normalizeExtrasStyles(extras: ExtrasOptions): ExtrasOptions {
  if (extras.danmaku?.enabled && (!extras.danmaku.style || Object.keys(extras.danmaku.style).length === 0)) {
    extras = { ...extras, danmaku: { ...extras.danmaku, style: DEFAULT_DANMAKU_STYLE } };
  }
  if (extras.subtitle?.enabled && (!extras.subtitle.style || Object.keys(extras.subtitle.style).length === 0)) {
    extras = { ...extras, subtitle: { ...extras.subtitle, style: DEFAULT_SUBTITLE_STYLE } };
  }
  return extras;
}

export class DownloadManager {
  #http: HttpClient;
  #store: TaskStore;
  #history: HistoryService;
  /** 匿名会话引导（buvid/bili_ticket 等指纹 cookie），首次解析前就绪（最佳努力，不失败） */
  #sessionReady: Promise<void>;
  #rootDir: string;
  /** 收藏夹封面缓存（folder id → 封面 URL；失败也缓存，短 TTL，避免 412 后立刻重试） */
  #coverCache = new Map<number, { cover: string; at: number }>();
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
  /** 最近一次从 nav 取回的登录用户信息（可选字段；尽力而为，未取到保持 undefined） */
  #user: { uname?: string; face?: string; mid?: number } | undefined;
  /** CDN 节点（advanced.cnCdnHosts + ovCdnHosts），取流时作为候选地址前缀 */
  #cdnHosts: string[] = [];
  /** 自定义 ffmpeg 可执行文件路径（advanced.ffmpegPath） */
  #ffmpegPath: string | undefined = undefined;
  /** 配置变更监听者（MCP 服务器启停用） */
  #configListeners: Array<(cfg: AppConfig) => Promise<void> | void> = [];
  /** 下载前是否预分配文件空间（behavior.preallocateFileSpace，桌面默认开） */
  #preallocate = true;
  /** 产物重名策略（config.download.renamePolicy）：auto=自动加后缀 overwrite=覆盖 */
  #renamePolicy: "auto" | "overwrite" = "auto";
  /** 重复下载策略（config.download.duplicatePolicy）：prompt=询问 skip=跳过 force=强制 */
  #duplicatePolicy: "prompt" | "skip" | "force" = "prompt";

  constructor(opts: { dataDir: string; downloadDir?: string; httpClient?: HttpClient }) {
    this.#http = opts.httpClient ?? new HttpClient();
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
    const next = await this.#configStore.update(patch);
    // 统一刷新运行时：并发/限速/代理/CDN/ffmpeg + 重名/重复策略 + 下载目录（目录变更即时切换）
    this.#applyRuntimeConfig(next);
    // 并行上限变化后立即按新值推进队列（调大时 queued 任务马上补位，调小则保持现状）
    this.#scheduleNext();
    // 配置变更通知（MCP 服务器据此启停/重启：原版 `card.py:708-709,791-797` 也是"任一变化就重启"）
    for (const cb of this.#configListeners) {
      try { await cb(next); } catch { /* 监听者异常不影响配置保存 */ }
    }
    return next;
  }

  /** 导出当前配置（原版「配置文件设置 → 导出」） */
  async exportConfig(): Promise<AppConfig> {
    await this.#configReady;
    return this.#configStore.exportAll();
  }

  /** 导入配置（原版「配置文件设置 → 导入」）：净化 + 校验通过才落盘，并刷新运行时 */
  async importConfig(raw: unknown): Promise<AppConfig> {
    await this.#configReady;
    const next = await this.#configStore.replaceAll(raw);
    this.#applyRuntimeConfig(next);
    this.#scheduleNext();
    logInfo("config", "已导入配置文件");
    return next;
  }

  /** 重置为默认配置（原版「配置文件设置 → 重置」） */
  async resetConfig(): Promise<AppConfig> {
    await this.#configReady;
    const next = await this.#configStore.resetAll();
    this.#applyRuntimeConfig(next);
    this.#scheduleNext();
    logInfo("config", "已重置为默认配置");
    return next;
  }

  /** 注册配置变更监听（当前只有 MCP 服务器用） */
  onConfigChange(cb: (cfg: AppConfig) => Promise<void> | void): void {
    this.#configListeners.push(cb);
  }

  // ---------- 登录（SESSDATA cookie）----------

  /** 生成扫码登录会话（对应桌面 QRCode.generate）；成功后返回二维码与轮询 key */
  async qrLoginStart(): Promise<QrLoginSession> {
    const { url, qrcodeKey } = await qrGenerate(this.#http);
    return { qrUrl: url, qrcodeKey, status: QRCodeStatus.UNSCANNED };
  }

  /** 轮询扫码状态；一旦登录成功（code 0），把 B 站下发的 cookie 落库并返回已登录态 */
  async qrLoginPoll(qrcodeKey: string): Promise<QrLoginSession & { loggedIn: boolean }> {
    const status = await qrPoll(this.#http, qrcodeKey);
    if (status === QRCodeStatus.SUCCESS) {
      // B 站在 poll 响应 Set-Cookie 里下发 SESSDATA/bili_jct/DedeUserID，
      // HttpClient 已捕获进 jar；这里取回并持久化
      const sessdata = this.#http.jar.get("SESSDATA");
      if (sessdata) {
        this.#sessdata = sessdata;
        await this.#refreshUser();
        await this.#persistAuth();
      }
      return { qrUrl: "", qrcodeKey, status, loggedIn: !!sessdata };
    }
    return { qrUrl: "", qrcodeKey, status, loggedIn: false };
  }
  async loginAuth(sessdata: string): Promise<AuthStatus> {
    const raw = sessdata.trim();
    if (!raw) throw new BiliError("INVALID_URL", "SESSDATA 不能为空");
    // 粘贴内容可能是整段 Cookie（k=v 或 JSON），先解析出真实字段再落库；
    // 旧实现把整段文本原样当 SESSDATA 值，粘贴 `SESSDATA=x; bili_jct=y` 会存成无效登录态
    const cookies = parsePastedCookies(raw);
    const value = cookies.SESSDATA?.trim();
    if (!value) {
      throw new BiliError("INVALID_URL", "未找到 SESSDATA，请粘贴包含 SESSDATA 的 Cookie 或直接粘贴其值");
    }
    this.#sessdata = value;
    // 其余 cookie（bili_jct / DedeUserID 等）一并写入 jar，后续接口才能带上完整登录态
    for (const [name, cookieValue] of Object.entries(cookies)) this.#http.jar.set(name, cookieValue);
    this.#http.jar.set("SESSDATA", value);
    await this.#refreshUser();
    await this.#persistAuth();
    return this.#authStatusObj();
  }

  async logoutAuth(): Promise<AuthStatus> {
    this.#sessdata = undefined;
    this.#user = undefined;
    this.#http.jar.delete("SESSDATA", "bili_jct", "DedeUserID", "DedeUserID__ckMd5");
    try {
      await rm(join(this.#dataDir, "auth.json"), { force: true });
    } catch {
      // 文件已不存在则忽略
    }
    return { loggedIn: false, preview: "" };
  }

  async authStatus(): Promise<AuthStatus> {
    // 已登录但尚未缓存用户信息（旧 auth.json / 首次登录未取到）时，后台补拉一次并持久化
    if (this.#sessdata && !this.#user) {
      void this.#refreshUser().then(() => {
        if (this.#sessdata && this.#user) void this.#persistAuth();
      });
    }
    return this.#authStatusObj();
  }

  /** 组装当前登录态（含已缓存的用户昵称/头像/UID；未登录为空） */
  #authStatusObj(): AuthStatus {
    const base: AuthStatus = {
      loggedIn: !!this.#sessdata,
      preview: this.#sessdata ? this.#previewSessdata(this.#sessdata) : "",
    };
    if (!this.#sessdata) return base;
    const u = this.#user;
    if (u?.uname) base.uname = u.uname;
    if (u?.face) base.face = u.face;
    if (u?.mid !== undefined) base.mid = u.mid;
    return base;
  }

  /**
   * 尽力从 /x/web-interface/nav 拉取当前登录用户（昵称/头像/UID）。
   * 失败不抛错（保持 undefined，不阻塞登录流程）；已确认当前 SESSDATA 有效。
   */
  async #refreshUser(): Promise<void> {
    if (!this.#sessdata) { this.#user = undefined; return; }
    try {
      await this.#sessionReady;
      const nav = await this.#http.getJSON<{
        code: number;
        data?: { mid?: number; uname?: string; face?: string };
      }>(BILI_API_BASE + "/x/web-interface/nav", { timeoutMs: 3000 });
      if (nav.code !== 0 || !nav.data?.mid) {
        this.#user = undefined;
        return;
      }
      const d = nav.data;
      const mid = d.mid;
      if (typeof mid !== "number") { this.#user = undefined; return; }
      this.#user = {
        mid,
        ...(d.uname ? { uname: d.uname } : {}),
        ...(d.face ? { face: d.face } : {}),
      };
    } catch {
      // 拉取失败保留原有/清空，不阻断登录
      this.#user = undefined;
    }
  }

  /** 登录用户的 mid；未登录/登录态失效抛 LOGIN_REQUIRED（收藏夹与追番共用） */
  async #loginMid(): Promise<number> {
    await this.#sessionReady;
    if (!this.#sessdata) {
      throw new BiliError("LOGIN_REQUIRED", "请先登录");
    }
    const nav = await this.#http.getJSON<{ code: number; data?: { mid?: number } }>(BILI_API_BASE + "/x/web-interface/nav");
    const mid = nav.data?.mid;
    if (nav.code !== 0 || !mid) {
      throw new BiliError("LOGIN_REQUIRED", "登录态无效，请重新登录");
    }
    return mid;
  }

  /**
   * 逐个取**我创建的**收藏夹封面 —— `fav/resource/list` 的 `data.info.cover`（实测有）。
   *
   * 为什么单独一个接口、而不是塞进 `listFavFolders`：
   * 这里每取一个封面就是一次 `fav/resource/list` 请求，而**并发打满会把该接口打到 HTTP 412**
   * （上一轮实测 25 个并发必 412，而它正是"点进收藏夹解析"用的同一个接口）。
   * 所以：**限并发 3 + 结果缓存（10 分钟）+ 失败即止（412 立刻停手）**，
   * 并且前端是"列表先出来、封面随后填"（渐进式），不阻塞列表。
   */
  async listFavFolderCovers(ids: number[]): Promise<Record<number, string>> {
    const out: Record<number, string> = {};
    const now = Date.now();
    const todo: number[] = [];
    for (const id of ids) {
      const hit = this.#coverCache.get(id);
      if (hit) {
        const ttl = hit.cover ? COVER_TTL_MS : COVER_FAIL_TTL_MS;
        if (now - hit.at < ttl) {
          if (hit.cover) out[id] = hit.cover;
          continue;
        }
      }
      todo.push(id);
    }

    let aborted = false;
    const worker = async (): Promise<void> => {
      while (todo.length > 0 && !aborted) {
        const id = todo.shift() as number;
        try {
          const res = await this.#http.getJSON<{ code: number; data?: { info?: { cover?: string } } }>(
            BILI_API_BASE + "/x/v3/fav/resource/list",
            { params: { media_id: String(id), pn: 1, ps: 1, platform: "web" } },
          );
          const cover = res.code === 0 ? (res.data?.info?.cover ?? "") : "";
          this.#coverCache.set(id, { cover, at: Date.now() });
          if (cover) out[id] = cover;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          this.#coverCache.set(id, { cover: "", at: Date.now() });
          // 412 = 被反爬拦了：立刻停手，别把剩下的也打出去
          if (/412/.test(msg)) {
            aborted = true;
            logWarn("parse", `收藏夹封面请求被限流（HTTP 412），已停止剩余 ${todo.length} 个`);
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, todo.length) }, () => worker()));
    return out;
  }

  /**
   * 收藏夹面板的两个列表（1:1 原版收藏夹浮层）：
   * - `created`：我创建的（`fav/folder/created/list-all`，对应原版 `get_favorite_list`）
   * - `collected`：我订阅的（`fav/folder/collected/list`，对应原版 `get_subscription_list`，pn=1&ps=50）
   * 需登录，未登录抛 LOGIN_REQUIRED。
   *
   * ⚠️ 封面：**只有订阅合集这条接口会返回 `cover`**（实测字段），我创建的这条**没有封面字段**
   * （只有 id/fid/mid/attr/title/fav_state/media_count）。原版对我创建的那条走的是
   * `__query__{fid}` 懒加载（`view_model/model_base.py:28`，逐行可见时才请求）。
   * 这里**不做**那个逐个请求 —— 实测 25 个收藏夹并发调 `fav/resource/list` 会直接把该接口打到
   * **HTTP 412**（B 站反爬），而它正是"点进收藏夹解析"用的同一个接口，代价太大。
   * 因此 created 的 cover 一律留空，由前端画占位图。
   */
  async listFavFolders(kind: "created" | "collected" = "created"): Promise<{ mid: number; folders: Array<{ id: number; title: string; mediaCount: number; cover: string; url: string }> }> {
    const mid = await this.#loginMid();
    type FoldersResponse = {
      code: number;
      message?: string;
      data?: { list?: Array<{ id: number; title: string; media_count?: number; cover?: string; mid?: number }> };
    };
    const res: FoldersResponse =
      kind === "collected"
        ? await this.#http.getJSON<FoldersResponse>(BILI_API_BASE + "/x/v3/fav/folder/collected/list", {
            params: { up_mid: String(mid), pn: 1, ps: 50, platform: "web" },
          })
        : await this.#http.getJSON<FoldersResponse>(BILI_API_BASE + "/x/v3/fav/folder/created/list-all", {
            params: { up_mid: String(mid) },
          });
    if (res.code !== 0) {
      // 只有 -101 才是登录态问题；其余是接口业务错误，
      // 一律说成"请先登录"会把用户引到错误的排查方向
      if (res.code === -101) throw new BiliError("LOGIN_REQUIRED", "登录态无效，请重新登录");
      throw new BiliError("API_ERROR", res.message || "获取收藏夹失败", { apiCode: res.code });
    }
    const list = res.data?.list ?? [];
    return {
      mid,
      folders: list.map((f) => ({
        id: f.id,
        title: f.title,
        mediaCount: f.media_count ?? 0,
        cover: f.cover ?? "",
        /**
         * 两个列表的 URL 形态不一样，照抄原版 `parser/favorite.py`：
         * - 我创建的：`on_get_favorite_list_success` → `space.bilibili.com/{自己}/favlist?fid={id}`（favlist 语义）
         * - 我订阅的：`on_get_subscription_list_success` → `space.bilibili.com/{**作者**}/lists/{id}?type=season`（**合集 semantics**）
         *
         * ⚠️ 订阅合集**不能**用 `www.bilibili.com/list/ml{id}`：实测那样会解析成"我的默认收藏夹、0 条"。
         * 订阅合集在 B 站是**别人空间里的一个合集(season)**，必须带作者的 mid 走 season 接口。
         */
        url:
          kind === "collected"
            ? `https://space.bilibili.com/${f.mid ?? mid}/lists/${f.id}?type=season`
            : `https://space.bilibili.com/${mid}/favlist?fid=${f.id}`,
      })),
    };
  }

  /**
   * 登录用户追番/追剧列表（1:1 原版追番面板）。
   * `type`：1 追番 / 2 追剧（原版浮层的下拉只有这两档）；
   * `status`：0 全部 / 1 想看 / 2 在看 / 3 看过；
   * `ps=24` 对齐原版（`parser/favorite.py:68`），返回值带分页信息供前端分页器使用。
   */
  async listFollowBangumi(type = "1", status = 0, pn = 1): Promise<{
    follow: Array<{ seasonId: number; title: string; cover: string; type: string; newEp: string; progress: string; desc: string; isFinish: number; url: string }>;
    pagination: { total: number; page: number; pageSize: number; totalPages: number };
  }> {
    const mid = await this.#loginMid();
    const ps = 24;
    const page = Math.max(1, Math.floor(pn) || 1);
    const res = await this.#http.getJSON<{
      code: number;
      message?: string;
      data?: {
        list?: Array<{
          season_id: number; title: string; cover: string;
          season_type_name?: string;
          areas?: Array<{ name?: string }>;
          new_ep?: { index_show?: string };
          progress?: string; evaluate?: string; is_finish?: number; url?: string;
        }>;
        total?: number;
      };
    }>(BILI_API_BASE + "/x/space/bangumi/follow/list", {
      params: { type, pn: page, ps, follow_status: status, vmid: String(mid) },
    });
    if (res.code !== 0) {
      // 同上：-101 才是登录态问题；其余（如 type=3/4/5/7）是接口业务错误
      if (res.code === -101) throw new BiliError("LOGIN_REQUIRED", "登录态无效，请重新登录");
      throw new BiliError("API_ERROR", res.message || "获取追番列表失败", { apiCode: res.code });
    }
    const list = res.data?.list ?? [];
    const total = res.data?.total ?? list.length;
    const follow = list.map((b) => {
      // 原版卡片显示「{season_type_name} · {areas[0].name}」（poster_item_delegate 的 type 字段）
      const area = b.areas?.[0]?.name ?? "";
      const typeText = [b.season_type_name ?? "", area].filter(Boolean).join(" · ");
      return {
        seasonId: b.season_id,
        title: b.title,
        cover: b.cover ?? "",
        type: typeText,
        newEp: b.new_ep?.index_show ?? "",
        progress: b.progress ?? "",
        desc: b.evaluate ?? "",
        isFinish: b.is_finish ?? 0,
        url: b.url ?? `https://www.bilibili.com/bangumi/play/ss${b.season_id}`,
      };
    });
    return { follow, pagination: { total, page, pageSize: ps, totalPages: Math.max(1, Math.ceil(total / ps)) } };
  }

  #previewSessdata(s: string): string {
    if (s.length <= 10) return s;
    return `${s.slice(0, 4)}…${s.slice(-4)}`;
  }

  async #persistAuth(): Promise<void> {
    const payload: { sessdata: string; user?: { uname?: string; face?: string; mid?: number } } = {
      sessdata: this.#sessdata ?? "",
    };
    if (this.#user) payload.user = this.#user;
    await writeFile(join(this.#dataDir, "auth.json"), JSON.stringify(payload, null, 2), "utf8");
  }

  /** 重启后从 auth.json 还原登录态（幂等；在 init 时调用） */
  async #loadAuth(): Promise<void> {
    try {
      const raw = await readFile(join(this.#dataDir, "auth.json"), "utf8");
      const parsed = JSON.parse(raw) as { sessdata?: string; user?: { uname?: string; face?: string; mid?: number } };
      if (parsed.sessdata) {
        this.#sessdata = parsed.sessdata;
        this.#user = parsed.user ?? undefined;
        this.#http.jar.set("SESSDATA", parsed.sessdata);
      }
    } catch {
      // 无 auth.json / 解析失败：保持未登录
    }
  }

  // ---------- 解析会话 ----------

  async parseUrls(urls: string[], opts?: { expandInteractive?: boolean }): Promise<ParseResult[]> {
    // 桌面在启动时初始化匿名指纹 cookie（CookieManager.init_cookie_info），
    // Web 侧在首次解析前补齐同一套 cookie，降低 WBI 接口 412 概率
    await this.#sessionReady;
    // 互动视频：默认展开全部分支节点（MCP 的 parse 工具直接调这里，没有确认 UI）；
    // `/api/parse` 会显式传 false 走"先探测再确认"的两段式
    const expandInteractiveNodes = opts?.expandInteractive !== false;
    // 对齐桌面 Behavior > 保存解析历史：关闭时解析不写入 parse_history
    const saveParseHistory = (await this.#configReady.then(() => this.#configStore.get())).behavior.saveParseHistory;
    const results: ParseResult[] = [];
    for (const raw of urls) {
      const url = raw.trim();
      if (!url) continue;
      logInfo("parse", `开始解析，链接: ${url}`);
      const result = await parseUrl(this.ctx, url, { expandInteractiveNodes });
      logInfo("parse", `解析完成，链接: ${url}，条目: ${result.items.length}`);
      for (const item of result.items) {
        if (!this.#items.has(item.id)) {
          this.#items.set(item.id, item);
        }
      }
      if (saveParseHistory) {
        this.#store.addParseHistory({
          url,
          title: result.title ?? "",
          type: result.type,
          itemCount: result.items.length,
        });

      }
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
    // 互动视频两段式：只有显式 interactiveAll 才直接展开（见 ParseRequest.interactiveAll）
    const parseOpts = { expandInteractive: req.interactiveAll === true };
    if (!req.type) {
      return this.parseUrls(req.urls ?? [], parseOpts);
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

    return this.parseUrls(urls, parseOpts);
  }

  // ---------- 解析历史 ----------

  listParseHistory(): ParseHistoryEntry[] {
    return this.#store.listParseHistory();
  }

  deleteParseHistory(id: number): boolean {
    return this.#store.removeParseHistory(id);
  }

  /**
   * 单个稿件的分P 列表（原版 `MultiPartListsDialog` 的二次解析）：
   * 只取这个稿件自己的分P，**不展开合集**，也**不动主解析树**
   * （原版那句 `del info_data["data"]["ugc_season"]`）。
   */
  async listVideoParts(url: string): Promise<MediaItem[]> {
    await this.#sessionReady;
    const result = await parseUrl(this.ctx, url, { ignoreSeason: true });
    // 注册到内存条目表：拿到 itemId 后建任务/取媒体信息都要能查到
    for (const item of result.items) {
      if (!this.#items.has(item.id)) this.#items.set(item.id, item);
    }
    return result.items;
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
    const cfg = await this.#configReady.then(() => this.#configStore.get());
    const saveParseHistory = cfg.behavior.saveParseHistory;
    // 自动解析分页的页间隔（桌面 `parser/dynamic.py:74-75` 的 `time.sleep(auto_parse_interval)`）。
    // 请求过于频繁会触发 B 站风控，所以原版默认就等 2 秒；最后一页不等。
    const pageIntervalMs = Math.round(cfg.behavior.autoParseInterval * 1000);
    let first: ParseResult | undefined;
    const items: MediaItem[] = [];
    let pagination: ParseResult["pagination"];
    const MAX_AUTO_PAGES = 100; // 搜索全部时安全上限，防止异常接口导致请求失控
    const effectivePages = Math.min(pages, MAX_AUTO_PAGES);
    const lastPage = startPn + effectivePages - 1;
    for (let page = startPn; page < startPn + effectivePages; page += 1) {
      const result = await parseUrl(this.ctx, url, { pn: page });
      for (const item of result.items) {
        if (!this.#items.has(item.id)) this.#items.set(item.id, item);
        items.push(item);
      }
      if (!first) first = result;
      if (result.pagination) pagination = result.pagination;
      // 已到达最后一页则提前结束（避免请求不存在的页）
      if (result.pagination && page >= result.pagination.totalPages) break;
      // 无分页返回的接口：空页视为已到末页（搜索全部时安全停止）
      if (!result.pagination && result.items.length === 0 && page > startPn) break;
      if (page < lastPage && pageIntervalMs > 0) {
        await new Promise<void>((r) => setTimeout(r, pageIntervalMs));
      }
    }
    if (!first) return undefined;
    if (saveParseHistory) {
      this.#store.addParseHistory({
        url,
        title: first.title ?? "",
        type: first.type,
        itemCount: items.length,
      });
    }
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
      case "list":
      case "festival":
        // 这些类型直接接受链接（可多行/逗号分隔）
        return query
          .split(/\r?\n|,|;/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
      case "favlist": {
        // 收藏夹支持站内搜索：原链接已带 keyword 则原样，否则拼接 ?keyword=（对齐引擎 keywordFromUrl）
        const sep = (u: string) => (u.includes("?") ? "&" : "?");
        const kw = keyword ? (kw: string) => `${sep(kw)}keyword=${encodeURIComponent(keyword)}` : null;
        return query
          .split(/\r?\n|,|;/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
          .map((u) => (kw ? (/[?&]keyword=/.test(u) ? u : u + kw(u)) : u));
      }
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
  /** MP4 durl 某画质的约合带宽(bps)：durl 无单独带宽，用 size/timelength 估算 */
  #durlBandwidth(info: VideoMediaInfo, q: number): number {
    const list = info.durl ?? [];
    if (!list.length || info.timelength <= 0) return 0;
    const seg = list.find((d) => d.order === 0) ?? list[0]!;
    return Math.round(((seg.size ?? 0) * 8) / (info.timelength / 1000));
  }

  /** 某音质 id 对应的音频流带宽(bps)；找不到返回 0 */
  #audioBandwidth(info: VideoMediaInfo, id: number): number {
    const s = (info.audioList ?? []).find((a) => a.id === id);
    return s?.bandwidth ?? 0;
  }

  async mediaOptions(itemId: string): Promise<MediaOptionSummary> {
    const item = this.#items.get(itemId);
    if (!item) throw new BiliError("INVALID_URL", `条目不存在：${itemId}`);
    const info = await fetchPlayMediaInfo(this.ctx, item);
    const qualities: MediaOptionSummary["qualities"] = [];
    const seen = new Set<number>();
    for (const q of info.qualities) {
      seen.add(q);
      const byCodec = info.videoByQuality[q];
      const codecIds = byCodec ? Object.keys(byCodec).map(Number) : [];
      const codecs = codecIds.map((id) => ({ id, label: codecLabel(id) }));
      const firstBw = codecIds[0] != null && byCodec ? (byCodec[codecIds[0]]?.bandwidth ?? 0) : 0;
      const firstRef = codecIds[0] != null && byCodec ? byCodec[codecIds[0]] : undefined;
      qualities.push({
        id: q, label: videoQualityLabel(q), codecs, videoBandwidth: firstBw,
        ...(firstRef?.frameRate !== undefined ? { frameRate: firstRef.frameRate } : {}),
        ...(firstRef?.width !== undefined ? { width: firstRef.width } : {}),
        ...(firstRef?.height !== undefined ? { height: firstRef.height } : {}),
      });
    }
    // 单文件/MP4 直链形态（audio=m4a 192K、lesson=mp4 1080P、durl 视频）没有 DASH qualities，
    // 把接口返回的 mp4Qualities 补进选项，避免下拉只剩"自动"（Task 2.9 顺手修复）
    if (info.mediaType === "mp4" || info.singleFileExt) {
      for (const q of info.mp4Qualities) {
        if (seen.has(q)) continue;
        seen.add(q);
        const durlSize = info.durl?.find((d) => d.url)?.size;
        qualities.push({
          id: q, label: info.mp4QualityLabel[q] ?? String(q), codecs: [], videoBandwidth: this.#durlBandwidth(info, q),
          ...(typeof durlSize === "number" && durlSize > 0 ? { size: durlSize } : {}),
        });
      }
    }
    return {
      itemId,
      mediaType: info.mediaType,
      timelength: info.timelength,
      qualities,
      audioQualities: info.audioQualities.map((id) => {
        const ref = info.audioList.find((a) => a.id === id);
        return {
          id, label: audioQualityLabel(id), audioBandwidth: this.#audioBandwidth(info, id),
          ...(ref?.codecid !== undefined ? { audioCodecId: ref.codecid } : {}),
          ...(ref?.codecs ? { audioCodecs: ref.codecs } : {}),
        };
      }),
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
    // 重复策略在最终判定前读取（prompt=询问 skip=跳过 force=强制下载）
    const cfg0 = await this.#configReady.then(() => this.#configStore.get());
    const dupPolicy = cfg0.download.duplicatePolicy;
    for (const itemId of itemIds) {
      const item = this.#items.get(itemId);
      if (!item) throw new BiliError("INVALID_URL", "条目不存在：" + itemId);
      const hash = this.#hashOf(item);
      const isDup = this.#store.checkDuplicate(hash);
      // skip=跳过；prompt=询问（未强制时跳过并提示）；force 参数 = 用户显式覆盖任何策略
      const skipDup = isDup && !force && (dupPolicy === "skip" || dupPolicy === "prompt");
      if (skipDup) {
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
      // 用户本次勾选的命名规则优先固化；未传命名时才按全局规则解析
      const naming = options.naming;
      const rule =
        naming && naming.rule.length > 0
          ? naming.rule
          : this.#findRule(cfg.fileNaming.rules, conventionType)?.rule ??
            this.#findRule(DEFAULT_NAMING_RULES, conventionType)?.rule ??
            "{leaf_title}";
      const number =
        naming && (naming.number ?? "") !== ""
          ? naming.number
          : allocator.alloc(numberingType === 1 ? index + 1 : undefined);
      // 高级默认档位兜底：任务未显式指定画质/编码/音质时，用 advanced.default* 作为默认（对齐桌面默认档位语义）
      const resolved: DownloadOptions = {
        ...options,
        ...(options.videoQualityId === undefined && cfg.advanced.defaultVideoQualityId !== undefined
          ? { videoQualityId: cfg.advanced.defaultVideoQualityId }
          : {}),
        ...(options.videoCodecId === undefined && cfg.advanced.defaultCodecId !== undefined
          ? { videoCodecId: cfg.advanced.defaultCodecId }
          : {}),
        ...(options.audioQualityId === undefined && cfg.advanced.defaultAudioQualityId !== undefined
          ? { audioQualityId: cfg.advanced.defaultAudioQualityId }
          : {}),
        // 三个优先级数组来自 config（原版 config.py:73-100）。
        // 任务选项里显式给了就用任务的（对齐原版"弹窗内也能改优先级"），否则用配置的。
        ...(options.videoQualityPriority ? {} : { videoQualityPriority: [...cfg.download.videoQualityPriority] }),
        ...(options.audioQualityPriority ? {} : { audioQualityPriority: [...cfg.download.audioQualityPriority] }),
        ...(options.videoCodecPriority ? {} : { videoCodecPriority: [...cfg.download.videoCodecPriority] }),
        extras: normalizeExtrasStyles(deepMerge(cfg.additional, options.extras)),
        naming: { conventionType, rule, number },
        // 下载目录：调用方显式指定就用它的（下载选项弹窗「下载路径卡」），
        // 否则固化创建任务那一刻的全局目录（原版 `manager.py:105`
        // `task_info.File.download_path = config.get(config.download_path)`）。
        // 固化之后，用户再改全局目录不会把已排队任务的落盘位置一起搬走。
        ...(options.downloadDir && options.downloadDir.trim() !== "" ? {} : { downloadDir: this.#rootDir }),
      };
      const task = new ManagedTask(item, resolved);
      task.duplicate = duplicates.some((d) => d.itemId === item.id);
      this.#tasks.set(task.id, task);
      // 进入等待队列：先持久化 queued，再由调度器按并发上限启动
      this.#persist(task, { status: "queued" });
      task.pushLog("已加入队列，等待调度");
      logInfo("download", `创建任务：${task.summary().title}`);
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

  /**
   * 清空断点并重新入队（retry / redownload 共用）。
   * 会先把任务从待调度队列里摘掉，避免重复入队。
   */
  #requeue(task: ManagedTask, logText: string): TaskSummary {
    this.#removePending(task);
    task.resetForRun();
    task.files = {};
    task.error = undefined;
    task.outputPath = undefined;
    task.startedAt = undefined;
    task.progress = 0;
    task.downloadedBytes = 0;
    task.totalBytes = 0;
    this.#store.removeActive(task.id);
    task.update({ status: "queued" });
    task.pushLog(logText);
    this.#persist(task, { status: "queued", files: {} });
    this.#pending.push(task);
    this.#scheduleNext();
    return task.summary();
  }

  /**
   * 重新下载（原版 `download_list/model.py:339-365` 的 `redownload` +
   * `list_view.py:181-191`）：
   * - 已完成：从 completed 表搬回下载表，清断点重下；
   * - 下载中/解析中：**先中止并等收尾**，再清断点重下（原版是 `pause()` 后立刻 reset；
   *   我们是异步模型，必须先 await `runPromise`，否则 `#run` 的 catch 会把状态改回 cancelled）；
   * - 合并中：拒绝（文案「处于 FFmpeg 处理中的任务无法重新下载」）。
   *
   * 注：我们的 `TaskStatus` 没有 `converting` —— m4a→mp3 转换发生在 merging 阶段内部，
   * 所以那个状态由 `merging` 一并覆盖。
   */
  async redownloadTask(id: string): Promise<{ ok: true; task: TaskSummary } | { ok: false; reason: "notfound" | "ffmpeg" }> {
    const task = this.#tasks.get(id);
    if (!task) return { ok: false, reason: "notfound" };
    if (task.status === "merging") return { ok: false, reason: "ffmpeg" };
    if (RUNNING_STATUSES.has(task.status)) {
      task.cancel();
      await task.runPromise?.catch(() => undefined);
    }
    this.#store.removeCompleted(id);
    return { ok: true, task: this.#requeue(task, "重新下载：清空断点，重新加入队列") };
  }

  /** 重试：failed/cancelled → 清空断点、重建 download_task 行后全新下载（不续传） */
  retryTask(id: string): TaskSummary | undefined {
    const task = this.#tasks.get(id);
    if (!task) return undefined;
    if (task.status !== "failed" && task.status !== "cancelled") return undefined;
    return this.#requeue(task, "重试：清空断点，重新下载");
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

  /** 日志：读（最新的在前，可搜索）/ 清空（对齐桌面「日志」窗口的刷新与清除） */
  readLogs(opts: { search?: string; limit?: number } = {}): LogEntry[] {
    return logger()?.read(opts) ?? [];
  }

  clearLogs(): void {
    logger()?.clear();
  }

  /** 日志文件路径（排查时用；Web 端没有"打开日志目录"） */
  logFilePath(): string | undefined {
    return logger()?.filePath;
  }

  /**
   * 代理连通性测试（原版 `dialog/setting/proxy.py:83` 的对应物）：
   * 用**传入的代理**去问 B 站自己的 `x/web-interface/zone`，拿到出口 IP / 地区 / ISP。
   * 用同一个接口是有意的 —— 能通就说明"这个代理能访问 B 站"，比 ping 一个公共接口更贴近实际用途。
   */
  async testProxy(form: { proxyType: string; proxyServer: string; proxyPort: number; proxyUname: string; proxyPassword: string }): Promise<ProxyTestResult> {
    if (!form.proxyServer.trim()) return { ok: false, error: "未填写代理服务器地址" };
    const auth = form.proxyUname
      ? `${encodeURIComponent(form.proxyUname)}:${encodeURIComponent(form.proxyPassword)}@`
      : "";
    const url = `${form.proxyType}://${auth}${form.proxyServer.trim()}:${form.proxyPort}`;
    try {
      // 借引擎自己的 HttpClient 带上代理 —— 不在这里另引 undici，
      // 而且顺带复用了它的 UA / 超时 / 重试语义（与真实抓取同一条通路）
      const probe = new HttpClient({ proxy: url, timeoutMs: 10_000, retries: 0 });
      const body = await probe.getJSON<{ code?: number; data?: { ip?: string; country?: string; province?: string; city?: string; isp?: string } }>(
        "https://api.bilibili.com/x/web-interface/zone",
      );
      if (body.code !== 0 || !body.data) return { ok: false, error: `接口返回 code=${body.code ?? "?"}` };
      const d = body.data;
      const location = [d.country, d.province, d.city].filter(Boolean).join(" ") || "未知";
      return { ok: true, ip: d.ip ?? "未知", location, isp: d.isp || "未知" };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * 浏览给定绝对目录的子目录（下载目录选择器用）。
   * - 路径不存在 / 不是目录 / 为空 → 返回空列表；
   * - 只返回可读子目录的 name+path，隐藏项过滤规则与 #walk 一致（跳过 . 开头隐藏目录、node_modules、dist、.tmp）。
   */
  async listSubdirs(absDir: string): Promise<DirEntry[]> {
    const out: DirEntry[] = [];
    let entries;
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist" || entry.name === ".tmp") continue;
      const full = join(absDir, entry.name);
      try {
        if ((await stat(full)).isDirectory()) out.push({ name: entry.name, path: full });
      } catch {
        // 并发删除/无权限：跳过
      }
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
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
    // 重名/重复策略（新任务开始 / 配置变更时生效）
    this.#renamePolicy = cfg.download.renamePolicy;
    this.#duplicatePolicy = cfg.download.duplicatePolicy;
    // 下载目录：非空则用配置值，否则回落默认 <data>/downloads；变更时即时切换根目录与临时目录
    const dlDir = cfg.download.dir && cfg.download.dir.trim().length > 0
      ? cfg.download.dir
      : join(this.#dataDir, "downloads");
    if (dlDir !== this.#rootDir) {
      this.#rootDir = dlDir;
      this.#tmpDir = join(this.#rootDir, ".tmp");
      mkdirSync(this.#rootDir, { recursive: true });
      mkdirSync(this.#tmpDir, { recursive: true });
    }
    // advanced：代理、CDN、UA、ffmpeg 路径即时生效
    // 三态代理：disabled=直连、system=跟随环境变量、manual=用配置的代理服务器
    if (cfg.advanced.proxyMode === "system") this.#http.setSystemProxy();
    else this.#http.setProxy(resolveProxyUrl(cfg.advanced));
    this.#http.setDefaultUserAgent(cfg.advanced.userAgent);
    // 桌面按地区（area）只用其中一套节点，且受「优先使用服务商 CDN」开关控制
    // （`resolveCdnHosts` 里就是这个语义）；探测失败仍会回落到 B 站原始调度链接
    this.#cdnHosts = resolveCdnHosts(cfg.advanced);
    this.#ffmpegPath = cfg.advanced.ffmpegPath;
    this.#preallocate = cfg.behavior.preallocateFileSpace !== false;
  }

  /**
   * 重启恢复实现（见 init）：
   * - download_task 遗留任务一律置 interrupted，保留断点可手动继续；
   * - completed_task 里的已完成任务也恢复进内存，否则重启后"已完成"页签为空
   *   （完成历史只落在库里，前端列表读的是内存任务表）。
   */
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
    for (const rec of this.#store.listCompleted()) {
      const data = rec.data as (Partial<TaskSnapshot> & { outputPath?: string }) | null;
      if (!data || typeof data !== "object") continue;
      if (!data.item || !data.options) continue;
      const task = new ManagedTask(data.item, data.options, rec.taskId);
      task.status = "completed";
      task.progress = 100;
      task.outputPath = typeof data.outputPath === "string" ? data.outputPath : undefined;
      task.createdAt = rec.time;
      task.updatedAt = rec.time;
      task.pushLog("历史记录（服务重启前已完成）");
      this.#tasks.set(task.id, task);
      if (!this.#items.has(task.item.id)) this.#items.set(task.item.id, task.item);
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
      if (task.options.videoQualityPriority) streamOpts.videoQualityPriority = task.options.videoQualityPriority;
      if (task.options.videoCodecPriority) streamOpts.videoCodecPriority = task.options.videoCodecPriority;
      if (task.options.audioQualityPriority) streamOpts.audioQualityPriority = task.options.audioQualityPriority;
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
          // 预分配文件空间（桌面 Behavior > 下载处理 > 预分配文件空间，默认开）
          preallocate: this.#preallocate,
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
      const labels = this.#qualityLabels(task, resolved);
      const target = this.#outputTarget(task, labels);
      const extrasOpt = normalizeExtrasStyles(task.options.extras ?? DEFAULT_EXTRAS_OPTIONS);
      const gathered = await this.#gatherExtraInputs(task, taskDir, info, extrasOpt, container);

      // 合并/转封装（附加内容随 ffmpeg 一并内嵌）
      task.pushLog("开始合并/转封装（" + outExt + "）");
      task.update({ status: "merging" });
      this.#persist(task, { status: "merging" });
      const wantVideo = task.options.downloadVideo !== false;
      const wantAudio = task.options.downloadAudio !== false;
      const mergeVideoAudio = task.options.mergeVideoAudio !== false;
      // 仅下载视频流或仅音频流时无合并可言，直接转封装/改名
      const hasBoth = wantVideo && wantAudio && !info.singleFileExt;

      let finalPath: string | undefined;
      if (info.singleFileExt) {
        const part = files[0];
        if (!part) throw new BiliError("DOWNLOAD_FAILED", "缺少单文件直链");
        await rename(join(taskDir, part.fileName), tempOut);
        finalPath = await this.#placeOutput(task, tempOut, target.dir, target.stem, outExt);
      } else if (!hasBoth) {
        // 只下载视频流或只下载音频流：无合并，直接转封装/改名
        const onlyKey: "video" | "audio" = wantVideo ? "video" : "audio";
        finalPath = await this.#placeOutputSplit(task, files, taskDir, target.dir, target.stem, onlyKey, wantVideo ? outExt : "m4a");
      } else if (!mergeVideoAudio) {
        // 视频流/音频流分开下载（不合并）：各命名独立落盘
        const videoFinal = wantVideo
          ? await this.#placeOutputSplit(task, files, taskDir, target.dir, target.stem, "video", outExt)
          : undefined;
        const audioFinal = wantAudio && mergePlan.audioKey
          ? await this.#placeOutputSplit(task, files, taskDir, target.dir, target.stem, "audio", "m4a")
          : undefined;
        finalPath = videoFinal ?? audioFinal;
        // 产物以第一条实际落盘为准
        task.update({ status: "completed", progress: 100, outputPath: finalPath });
        this.#persist(task, { status: "completed" });
      } else {
        await this.#merge(task, taskDir, mergePlan, files, tempOut, container, gathered.merge);
        finalPath = await this.#placeOutput(task, tempOut, target.dir, target.stem, outExt);
        // 保留原始分片文件：把视频/音频 m4s 也落盘到产物目录
        if (task.options.keepOriginalFiles) {
          await this.#keepOriginalFiles(task, files, taskDir, target.dir, target.stem);
        }
      }
      const finalOut = finalPath as string; // 各分支均已落盘或抛错，此处必然存在
      await probeMedia(finalOut); // 校验产物可读（ffprobe）
      // 「将 M4A 转换为 MP3」（桌面 config.m4a_to_mp3，默认关）：**仅纯音频流**时生效。
      // 放在 probe 之后、写附加内容之前 —— 后面那些步骤都要用最终路径。
      const converted = await this.#maybeConvertM4aToMp3(task, finalOut);
      await this.#writeStandaloneExtras(task, converted, extrasOpt, gathered);
      task.update({ status: "completed", progress: 100, outputPath: converted });
      task.speedBps = 0;
      task.etaSec = 0;
      task.pushLog("下载完成：" + converted);
      logInfo("download", `下载完成：${task.summary().title} → ${converted}`);
      await rm(taskDir, { recursive: true, force: true });

      const completedData = {
        ...this.#storedSnapshot(task.id),
        status: "completed",
        outputPath: finalOut,
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
      // F12/F13：底层错误改写成"人能看懂的长提示"（零时序风险；原始信息仍进日志）
      task.update({ status: "failed", error: friendlyDownloadError(message) });
      this.#persist(task, { status: "failed" });
      task.pushLog("失败：" + message);
      logError("download", `任务失败：${task.summary().title}（${message}）`);
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
    const wantVideo = task.options.downloadVideo !== false;
    const wantAudio = task.options.downloadAudio !== false;
    if (resolved.mediaType === "dash" && resolved.videoRef) {
      let firstKey = "";
      const mergePlan: MergePlan = { kind: "dash", videoKey: "", partKeys: [] };
      if (wantVideo) {
        const videoFile: PlannedFile = {
          key: "video",
          urls: this.#candidateUrls([resolved.videoRef.baseUrl, ...resolved.videoRef.backupUrl]),
          fileName: `video_${task.id}.m4s`,
        };
        files.push(videoFile);
        firstKey = "video";
        mergePlan.videoKey = "video";
      } else if (resolved.audioRef) {
        // 仅音频：音频作为主文件
        firstKey = "audio";
        mergePlan.videoKey = "";
      }
      if (wantAudio && resolved.audioRef) {
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

  /**
   * 「将 M4A 转换为 MP3」—— 对齐桌面 `merger.py:338-363` + `ffmpeg/command.py:154-161`。
   *
   * - **仅纯音频流**（选了视频就不转），与原版卡片描述一致
   * - 参数逐字照抄：`-c:a libmp3lame -q:a 2`
   * - **先输出到独立临时名、成功后再改扩展名** —— 原版注释解释了原因：
   *   转换中途失败/退出时，重试仍要能按 m4a 判断，若就地把扩展名改成 mp3，
   *   重试会去重命名一个根本不存在的 mp3。
   * - 转换后删除 m4a（原版转换产物在临时目录，m4a 不会留存）
   *
   * ⚠️ 与桌面的一处差异：桌面有独立的 `CONVERTING` 状态（「转换中」），
   * 我们复用了 ffmpeg 家族的 `merging` 状态并写一条任务日志 —— 新增状态要动
   * TaskStatus 联合类型与前端映射，收益不抵改动面。
   */
  async #maybeConvertM4aToMp3(task: ManagedTask, input: string): Promise<string> {
    if (!input.toLowerCase().endsWith(".m4a")) return input;
    const cfg = await this.#configReady.then(() => this.#configStore.get());
    if (!cfg.download.m4aToMp3) return input;
    // 仅纯音频流：选了视频就不转
    if (task.options.downloadVideo !== false || task.options.downloadAudio === false) return input;

    const cwd = dirname(input);
    const tempOut = join(cwd, `output_${task.id}.mp3`);
    task.pushLog("正在转换为 MP3…");
    task.update({ status: "merging" });
    try {
      await runFfmpeg(
        [this.#ffmpegPath ?? "ffmpeg", "-i", input, "-c:a", "libmp3lame", "-q:a", "2", tempOut],
        { cwd, ...(task.signal ? { signal: task.signal } : {}) },
      );
      const out = input.replace(/\.m4a$/i, ".mp3");
      await rename(tempOut, out);
      await rm(input, { force: true });
      task.pushLog("已转换为 MP3：" + out);
      logInfo("download", `已转换为 MP3：${out}`);
      return out;
    } catch (e) {
      // 转换失败不该毁掉已下载的音频：保留 m4a 并按成功收尾（记日志说明）
      await rm(tempOut, { force: true });
      const msg = e instanceof Error ? e.message : String(e);
      task.pushLog(`转换为 MP3 失败，保留原文件：${msg}`);
      logWarn("download", `转换为 MP3 失败（保留 m4a）：${msg}`);
      return input;
    }
  }

  async #merge(    task: ManagedTask,
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
    const target = join(dir, `${stem}.${ext}`);
    if (this.#renamePolicy === "overwrite") {
      // 覆盖策略：直接落盘为同名目标（对齐桌面“覆盖同名文件”）
      await rename(tempOut, target);
      return target;
    }
    const unique = await this.#uniquePath(target);
    await rename(tempOut, unique);
    return unique;
  }

  /** 不合并时，把视频/音频 m4s 转封装为可播容器并落盘（视频→mp4，音频→m4a） */
  async #placeOutputSplit(
    task: ManagedTask,
    files: PlannedFile[],
    taskDir: string,
    dir: string,
    stem: string,
    key: "video" | "audio",
    ext: string,
  ): Promise<string> {
    const file = files.find((f) => f.key === key);
    if (!file) throw new BiliError("DOWNLOAD_FAILED", `缺少${key === "video" ? "视频" : "音频"}文件`);
    await mkdir(dir, { recursive: true });
    const suffix = key === "video" ? "video" : "audio";
    const tempOut = join(taskDir, `out_${suffix}_${task.id}.${ext}`);
    const src = join(taskDir, file.fileName);
    // m4s 为 fMP4 分片，需 ffmpeg 转封装为可播容器（-c copy 保码流）。
    // 输出容器由文件扩展名决定（mp4/mkv/m4a 均为 MP4 家族）；这里用 mp4 语义避免触发附加内容内嵌。
    await remuxMedia(src, tempOut, {
      container: "mp4",
      signal: task.signal,
      ...(this.#ffmpegPath !== undefined ? { ffmpegPath: this.#ffmpegPath } : {}),
    });
    const target = join(dir, `${stem}_${suffix}.${ext}`);
    if (this.#renamePolicy === "overwrite") {
      await rename(tempOut, target);
      return target;
    }
    const unique = await this.#uniquePath(target);
    await rename(tempOut, unique);
    return unique;
  }

  /**
   * 合并后保留原始分片文件（视频/音频 m4s 或直链 mp4 分片），落盘在产物目录。
   * 保留范围由 keepOriginalFilesType（0=仅视频 / 1=仅音频 / 2=视频+音频）决定，
   * 缺省按 2 处理（与前端"全部"档一致）；分片 key 约定见 #buildPlan。
   */
  async #keepOriginalFiles(
    task: ManagedTask,
    files: PlannedFile[],
    taskDir: string,
    dir: string,
    stem: string,
  ): Promise<void> {
    await mkdir(dir, { recursive: true });
    const keepType = task.options.keepOriginalFilesType ?? 2;
    const kept = files.filter((f) => {
      if (keepType === 1) return f.key === "audio";
      if (keepType === 0) return f.key === "video" || f.key.startsWith("video_part_");
      return true;
    });
    // 复制（不移动）原始分片到产物目录，避免重复命名冲突时影响已合并产物
    for (const file of kept) {
      const src = join(taskDir, file.fileName);
      const target = join(dir, `${stem}.${file.fileName}`);
      await rename(src, target).catch(async (err) => {
        // 已存在同名则跳过（保留默认行为）
        if ((err as Error).message.includes("EEXIST")) return;
        throw err;
      });
    }
  }
  // ---------- P3：命名与附加内容管线 ----------

  /** 从命名规则列表取指定分类的规则（默认优先） */
  #findRule(rules: NamingRule[], type: number): NamingRule | undefined {
    return rules.find((r) => r.type === type && r.default === true) ?? rules.find((r) => r.type === type);
  }

  /** 档位展示标签（命名变量 video_quality/audio_quality/video_codec） */
  #qualityLabels(task: ManagedTask, resolved: ResolvedStreams): NamingQuality {
    return {
      videoQuality: videoQualityLabel(resolved.videoQualityId),
      audioQuality: resolved.audioQualityId > 0 ? audioQualityLabel(resolved.audioQualityId) : "",
      // 编码取决于"本次是否下载视频流"，与音频无关：
      // 改前判 audioQualityId，导致音频流选不中（audioQualityId=0）时 video_codec 恒为空
      videoCodec:
        task.options.downloadVideo === false ? "" : (VIDEO_CODEC_STR[resolved.videoCodecId] ?? ""),
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
    // 下载目录：任务创建时已固化（见 createTasks），这里只做回落兜底
    const base = task.options.downloadDir && task.options.downloadDir.trim() !== "" ? task.options.downloadDir.trim() : this.#rootDir;
    return { dir: folder ? join(base, folder) : base, stem };
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
        logWarn("extras", `附加内容 ${label} 写入失败（不影响主文件）: ${err instanceof Error ? err.message : String(err)}`);
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

