/** 与后端 download-manager.ts DTO 对齐的前端类型（P1 起使用，逐字段核对后端） */

export type ItemKind = "video" | "bangumi" | "cheese" | "lesson" | "audio";
export type ContainerType = "space" | "favlist" | "popular" | "watch_later" | "history" | "list";
export type ContentType =
  | "video" | "bangumi" | "cheese" | "lesson" | "audio"
  | "space" | "favlist" | "popular" | "watch_later" | "history" | "list";

export interface MediaItem {
  id: string;
  type: ItemKind;
  aid?: number;
  bvid?: string;
  cid?: number;
  epId?: number;
  seasonId?: number;
  auId?: number;
  sid?: number;
  courseId?: number;
  lessonId?: number;
  itemId?: number;
  sectionId?: number;
  interactive?: boolean;
  page: number;
  title: string;
  groupTitle: string;
  duration: number;
  badge: string;
  cover: string;
  pubtime: number;
  owner: { mid: number; name: string; face: string };
  desc: string;
  url: string;
  containerType?: ContainerType;
  containerTitle?: string;
  partCount?: number;
  seasonTitle?: string;
  episodeTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  sectionTitle?: string;
  collectionTitle?: string;
  seriesTitle?: string;
  favoritesId?: number;
  favoritesName?: string;
  favoritesOwner?: { mid: number; name: string };
  favtime?: number;
  viewtime?: number;
}

export interface ParseResult {
  type: ContentType;
  title?: string;
  items: MediaItem[];
  redirectUrl?: string;
  pagination?: { total: number; page: number; pageSize: number; totalPages: number };
  /** 链接指向的那一项（对齐原版 current_episode_data）：条件式自动勾选与媒体信息预览都要用 */
  target?: { key: "cid" | "ep_id" | "section_id"; value: number };
  /** 命中互动视频且尚未展开分支节点 → 前端先弹「检测到互动视频，请选择操作」 */
  interactiveDetected?: boolean;
}

export type TaskStatus =
  | "queued" | "parsing" | "downloading" | "merging"
  | "paused" | "interrupted" | "completed" | "failed" | "cancelled";

export interface DownloadOptions {
  videoQualityId?: number;
  /** 本次任务的下载目录（原版下载选项弹窗「下载路径卡」）；留空 = 用创建任务时的全局目录 */
  downloadDir?: string;
  videoCodecId?: number;
  audioQualityId?: number;
  container?: "mp4" | "mkv";
  downloadVideo?: boolean;
  downloadAudio?: boolean;
  mergeVideoAudio?: boolean;
  keepOriginalFiles?: boolean;
  keepOriginalFilesType?: number;
  videoQualityPriority?: number[];
  videoCodecPriority?: number[];
  audioQualityPriority?: number[];
  extras?: Record<string, unknown>;
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
  outputPath?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
  qualityLabel: string;
  startedAt?: number;
  speedBps?: number;
  etaSec?: number;
  cover?: string;
  /** 条目的原始链接（右键「重新解析」用） */
  url?: string;
}

export interface MediaOptionSummary {
  itemId: string;
  mediaType: "dash" | "mp4";
  timelength: number;
  qualities: Array<{
    id: number; label: string; codecs: Array<{ id: number; label: string }>; videoBandwidth: number;
    /** 帧率（原版媒体信息行会显示它；DASH 的 playurl 里有） */
    frameRate?: string;
    width?: number; height?: number;
    /** MP4/durl 形态下接口给的真实字节数 */
    size?: number;
  }>;
  audioQualities: Array<{ id: number; label: string; audioBandwidth: number; audioCodecId?: number; audioCodecs?: string }>;
}

/** 解析后自动勾选策略（对齐桌面 AutoSelectMode 枚举） */
export type AutoSelectMode = "manual" | "all" | "conditional";

/** 条件式自动勾选的三类条件（0 = 仅链接指向的那一项；1 = 该类的全部） */
export interface AutoSelectConditions {
  userUploads: 0 | 1;
  bangumi: 0 | 1;
  other: 0 | 1;
}

/** 全局配置（config.ts 的 AppConfig，前端只读/写关心的子集） */
export interface AppConfig {
  behavior: {
    language: string;
    theme: string;
    saveParseHistory: boolean;
    showDownloadOptionsDialog: boolean;
    /** 下载前预分配文件空间（桌面 `preallocate_file_space`，默认开） */
    preallocateFileSpace: boolean;
    /** 监听剪贴板（Web 改写：聚焦时读一次，命中只填入不自动解析；默认关） */
    monitorClipboard?: boolean;
    /** 解析后自动勾选策略（对齐原版 auto_select_mode_，默认 conditional） */
    autoSelectMode: AutoSelectMode;
    autoSelectConditions: AutoSelectConditions;
    /** 结果有分页时直接弹「自动解析分页」对话框（默认关；关着先显示教学气泡） */
    showAutoParseDialog: boolean;
    /** 自动解析分页时每页之间的间隔秒数（0.1–15，默认 2） */
    autoParseInterval: number;
    /** 每解析完一页/一条链接后自动加入下载列表（默认关） */
    autoAddToDownloadList: boolean;
  };
  download: {
    dir: string; parallel: number; threads: number; speedLimitKbps: number;
    renamePolicy: string; duplicatePolicy: string; defaultContainer: "mp4" | "mkv";
    /** 仅下载音频流时把 m4a 转成 mp3（默认关） */
    m4aToMp3?: boolean;
    /** 画质/音质/编码优先级（对齐服务端 DownloadConfig；默认值同桌面版 config.py:73-100） */
    videoQualityPriority: number[]; audioQualityPriority: number[]; videoCodecPriority: number[];
  };
  additional: Record<string, unknown>;
  fileNaming: { rules: unknown[]; numberingType: number; startingNumber: number };
  /** 高级组（字段与服务端 AdvancedConfig 一一对应，取用前先判存在） */
  advanced: {
    cnCdnHosts?: string[]; ovCdnHosts?: string[];
    /** 优先使用服务商 CDN（默认开） */
    preferCdnServerProvider?: boolean;
    /** 地理位置：cn 大陆 / ov 大陆以外（决定用哪份 CDN 列表） */
    area?: "cn" | "ov";
    ffmpegPath?: string;
    proxyMode?: "disabled" | "system" | "manual";
    proxyType?: "http";
    proxyServer?: string;
    proxyPort?: number;
    proxyUname?: string;
    proxyPassword?: string;
    userAgent?: string;
  };
}

/** 代理连通性测试结果（服务端 `routes.ts` 里有同名定义） */
export interface ProxyTestResult {
  ok: boolean;
  ip?: string;
  location?: string;
  isp?: string;
  error?: string;
}

/** 应用日志条目（服务端 `logger.ts` 有同名定义；字段就是解析出来的四段 + message） */
export interface LogEntry {
  timestamp: string;
  name: string;
  level: string;
  callsite: string;
  message: string;
}

/** 配置部分更新（与后端 AppConfigPatch 对齐）：组内字段均可缺省 */
export interface AppConfigPatch {
  additional?: Record<string, unknown>;
  fileNaming?: { rules?: unknown[]; numberingType?: number; startingNumber?: number };
  download?: Partial<AppConfig["download"]>;
  behavior?: Partial<AppConfig["behavior"]>;
  advanced?: Partial<NonNullable<AppConfig["advanced"]>>;
}