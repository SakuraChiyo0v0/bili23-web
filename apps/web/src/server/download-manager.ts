import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm, rename, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import {
  BiliError,
  DownloadAbortedError,
  HistoryService,
  HttpClient,
  TaskStore,
  calcHashId,
  concatMediaParts,
  ensureAnonymousSession,
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
} from "@bili23-web/engine";

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
  | "completed"
  | "failed"
  | "cancelled";

export interface DownloadOptions {
  videoQualityId?: number;
  videoCodecId?: number;
  audioQualityId?: number;
  /** 输出容器，默认 mp4 */
  container?: "mp4" | "mkv";
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

class ManagedTask {
  readonly id: string;
  readonly item: MediaItem;
  readonly options: DownloadOptions;
  status: TaskStatus = "queued";
  progress = 0;
  downloadedBytes = 0;
  totalBytes = 0;
  outputPath?: string;
  error?: string;
  createdAt = Math.floor(Date.now() / 1000);
  updatedAt = this.createdAt;
  duplicate = false;
  #abort = new AbortController();
  readonly #listeners = new Set<Listener>();

  constructor(item: MediaItem, options: DownloadOptions) {
    this.id = randomUUID();
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
    this.updatedAt = Math.floor(Date.now() / 1000);
    const summary = this.summary();
    for (const l of [...this.#listeners]) l(summary);
  }

  cancel(): void {
    this.#abort.abort();
  }
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

  constructor(opts: { dataDir: string; downloadDir?: string }) {
    this.#http = new HttpClient();
    this.#sessionReady = ensureAnonymousSession(this.ctx);
    this.#rootDir = opts.downloadDir ?? join(opts.dataDir, "downloads");
    this.#tmpDir = join(this.#rootDir, ".tmp");
    void mkdir(opts.dataDir, { recursive: true });
    void mkdir(this.#rootDir, { recursive: true });
    void mkdir(this.#tmpDir, { recursive: true });
    this.#store = new TaskStore(join(opts.dataDir, "task.db"));
    this.#history = new HistoryService(this.#store);
  }

  get ctx(): ParseContext {
    return { http: this.#http };
  }

  close(): void {
    this.#store.close();
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
      results.push(result);
    }
    return results;
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
      if (!item) throw new BiliError("INVALID_URL", `条目不存在：${itemId}`);
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
    for (const { item, hash } of items) {
      const task = new ManagedTask(item, options);
      task.duplicate = duplicates.some((d) => d.itemId === item.id);
      this.#tasks.set(task.id, task);
      const snapshot: TaskSnapshot = { item, options, status: task.status, files: {} };
      this.#store.upsertActive({
        taskId: task.id,
        hashId: hash,
        title: item.title,
        data: snapshot,
      });
      created.push(task);
      void this.#run(task).catch(() => undefined);
    }
    return { tasks: created.map((t) => t.summary()), duplicates };
  }

  /** 取消（中止下载/合并） */
  cancelTask(id: string): void {
    const task = this.#tasks.get(id);
    if (!task) return;
    task.cancel();
  }

  /** 产物目录浏览（不含 .tmp 临时目录） */
  async listFiles(): Promise<FileEntry[]> {
    return this.#walk(this.#rootDir);
  }

  // ---------- 内部执行 ----------

  async #run(task: ManagedTask): Promise<void> {
    try {
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

      // 加载断点快照（服务重启/中断后 retry 续传）
      const stored = this.#storedSnapshot(task.id);
      const resumeMap = stored?.files ?? {};
      let doneBytes = 0;

      for (const pf of probed) {
        if (task.aborted) throw new DownloadAbortedError();
        const destPath = join(taskDir, pf.fileName);
        const snapshot = resumeMap[pf.key];
        await downloadFile({
          http: this.#http,
          url: pf.url,
          destPath,
          fileSize: pf.fileSize,
          referer: "https://www.bilibili.com/",
          concurrency: 4,
          signal: task.signal,
          ...(snapshot ? { state: snapshot } : {}),
          onProgress: (p) => {
            const others = doneBytes;
            const partial = Math.min(p.downloadedBytes, pf.fileSize);
            task.update({
              downloadedBytes: others + partial,
              progress: totalBytes > 0 ? ((others + partial) / totalBytes) * 100 : 0,
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

      // 合并/转封装
      task.update({ status: "merging" });
      this.#persist(task, { status: "merging" });
      const container = task.options.container ?? "mp4";
      // audio(m4a)/lesson(mp4) 属单文件直链：下载件即成品，仅改名不再过 ffmpeg；
      // 输出扩展名以接口语义为准，忽略用户容器选择（桌面同样保持 m4a/mp4 直出）
      const outExt = info.singleFileExt ?? container;
      const tempOut = join(taskDir, `output_${task.id}.${outExt}`);
      if (info.singleFileExt) {
        const part = files[0];
        if (!part) throw new BiliError("DOWNLOAD_FAILED", "缺少单文件直链");
        await rename(join(taskDir, part.fileName), tempOut);
      } else {
        await this.#merge(task, taskDir, mergePlan, files, tempOut, container);
      }

      // 落盘到最终目录
      const finalPath = await this.#placeOutput(task, tempOut, outExt);
      await probeMedia(finalPath); // 校验产物可读（ffprobe）
      task.update({ status: "completed", progress: 100, outputPath: finalPath });
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
    } catch (err) {
      if (task.aborted || err instanceof DownloadAbortedError) {
        task.update({ status: "cancelled" });
        this.#store.removeActive(task.id);
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      task.update({ status: "failed", error: message });
      this.#persist(task, { status: "failed" });
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
        urls: [resolved.videoRef.baseUrl, ...resolved.videoRef.backupUrl],
        fileName: `video_${task.id}.m4s`,
      };
      files.push(videoFile);
      const mergePlan: MergePlan = { kind: "dash", videoKey: "video", partKeys: [] };
      if (resolved.audioRef) {
        files.push({
          key: "audio",
          urls: [resolved.audioRef.baseUrl, ...resolved.audioRef.backupUrl],
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
        urls: [part.url, ...part.backupUrl],
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
  ): Promise<void> {
    const byKey = new Map(files.map((f) => [f.key, f]));
    if (plan.kind === "dash") {
      const video = byKey.get(plan.videoKey);
      const audio = plan.audioKey ? byKey.get(plan.audioKey) : undefined;
      if (!video) throw new BiliError("DOWNLOAD_FAILED", "缺少视频文件");
      const videoPath = join(taskDir, video.fileName);
      const audioPath = audio ? join(taskDir, audio.fileName) : undefined;
      if (audioPath) {
        await mergeAudioVideo(videoPath, audioPath, tempOut, { container, signal: task.signal });
      } else {
        await remuxMedia(videoPath, tempOut, { container, signal: task.signal });
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
    await concatMediaParts(listPath, tempOut, { container, signal: task.signal, cwd: taskDir });
  }

  async #placeOutput(task: ManagedTask, tempOut: string, ext: string): Promise<string> {
    const folder = sanitizeFileName(task.item.groupTitle || task.item.title);
    const dir = join(this.#rootDir, folder);
    await mkdir(dir, { recursive: true });
    const base = sanitizeFileName(task.item.title);
    const unique = await this.#uniquePath(join(dir, `${base}.${ext}`));
    await rename(tempOut, unique);
    return unique;
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
