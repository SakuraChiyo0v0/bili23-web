export type ItemKind = "video" | "bangumi" | "cheese" | "lesson" | "audio";
export type ContainerType = "space" | "favlist" | "popular" | "watch_later" | "history" | "list";
export type ContentType =
  | "video"
  | "bangumi"
  | "cheese"
  | "lesson"
  | "audio"
  | "space"
  | "favlist"
  | "history"
  | "watch_later"
  | "popular"
  | "list"
  | "festival"
  | "b23"
  | "unknown";

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
}

export interface ParseHistoryEntry {
  id: number;
  url: string;
  title: string;
  type: string;
  itemCount: number;
  createdAt: number;
}

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
}

export interface MediaOptionSummary {
  itemId: string;
  mediaType: "dash" | "mp4";
  timelength: number;
  qualities: Array<{ id: number; label: string; codecs: Array<{ id: number; label: string }> }>;
  audioQualities: Array<{ id: number; label: string }>;
}

export interface FileEntry {
  name: string;
  path: string;
  size: number;
  mtime: number;
}

export interface HistoryEntryDto {
  taskId: string;
  title: string;
  completedAt: number;
  outputPath?: string;
  error?: string;
}

export type DanmakuFormat = "xml" | "ass" | "json";
export type SubtitleFormat = "srt" | "lrc" | "txt" | "ass" | "json";
export type CoverFormat = "jpg" | "png" | "avif" | "webp";
export type MetadataFormat = "nfo" | "json";
// ---------- 弹幕/字幕样式（语义对齐引擎 DanmakuStyle/SubtitleStyle） ----------

export interface DanmakuFont {
  name: string;
  /** 字号（像素） */
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
}

export interface DanmakuStyle {
  font: DanmakuFont;
  border: { border: number; shadow: number };
  advanced: { displayArea: number; opacity: number; scrollDuration: number; staticDuration: number; minimumGap: number };
  resolution: { width: number; height: number };
}

export interface SubtitleStyle {
  font: DanmakuFont;
  border: { border: number; shadow: number };
  color: { primary: string; secondary: string; border: string; shadow: string };
  margin: { left: number; right: number; vertical: number };
  resolution: { width: number; height: number };
  /** ASS Alignment（2=底部居中） */
  alignment: number;
}

/** 字幕语言选择（语义对齐引擎 SubtitleLanguageSelection） */
export interface SubtitleLanguageSelection {
  /** 是否只下载指定语言（download_specified） */
  downloadSpecified: boolean;
  /** 指定下载的语言码列表（B 站 lan，如 zh/en/ai-zh） */
  specifiedLanguages: string[];
}

export interface ExtrasOptions {
  danmaku?: {
    enabled: boolean;
    format: DanmakuFormat;
    style?: DanmakuStyle;
    embed?: boolean;
    deleteAfterEmbed?: boolean;
  };
  subtitle?: {
    enabled: boolean;
    format: SubtitleFormat;
    language?: SubtitleLanguageSelection;
    style?: SubtitleStyle;
    embed?: boolean;
    deleteAfterEmbed?: boolean;
  };
  cover?: {
    enabled: boolean;
    format: CoverFormat;
    attach?: boolean;
    deleteAfterAttach?: boolean;
  };
  chapter?: { embed: boolean };
  metadata?: { enabled: boolean; format: MetadataFormat };
}

export interface NamingRule {
  id: string;
  name: string;
  type: number;
  rule: string;
  default: boolean;
}

export interface DownloadOptions {
  videoQualityId?: number;
  videoCodecId?: number;
  audioQualityId?: number;
  container?: "mp4" | "mkv";
  /** 是否下载视频流（缺省 true） */
  downloadVideo?: boolean;
  /** 是否下载音频流（缺省 true） */
  downloadAudio?: boolean;
  /** 是否合并音视频（缺省 true） */
  mergeVideoAudio?: boolean;
  /** 保留原始分片文件 */
  keepOriginalFiles?: boolean;
  /** 保留原始文件类型 */
  keepOriginalFilesType?: number;
  /** 画质优先级（从高到低） */
  videoQualityPriority?: number[];
  /** 编码优先级 */
  videoCodecPriority?: number[];
  /** 音质优先级 */
  audioQualityPriority?: number[];
  extras?: ExtrasOptions;
  naming?: { conventionType: number; rule: string; number: number | "" };
}



export interface DownloadConfig {
  dir: string;
  parallel: number;
  threads: number;
  speedLimitKbps: number;
  renamePolicy: "auto" | "overwrite";
  duplicatePolicy: "prompt" | "skip" | "force";
  defaultContainer: "mp4" | "mkv";
}

export interface BehaviorConfig {
  language: "zh-CN" | "zh-TW" | "en" | "system";
  theme: "light" | "dark" | "system";
}

export interface AdvancedConfig {
  defaultVideoQualityId?: number;
  defaultAudioQualityId?: number;
  defaultCodecId?: number;
  cdnHosts: string[];
  ffmpegPath?: string;
  proxy?: string;
}

export interface AppConfig {
  additional: ExtrasOptions;
  fileNaming: { rules: NamingRule[]; numberingType: number; startingNumber: number };
  download: DownloadConfig;
  behavior: BehaviorConfig;
  advanced: AdvancedConfig;
}

export type AppConfigPatch = {
  additional?: Partial<ExtrasOptions>;
  fileNaming?: Partial<AppConfig["fileNaming"]>;
  download?: Partial<DownloadConfig>;
  behavior?: Partial<BehaviorConfig>;
  advanced?: Partial<AdvancedConfig>;
};

export interface AuthStatus {
  loggedIn: boolean;
  preview: string;
}

/** 扫码登录会话（前端轮询状态用） */
export interface QrLoginSession {
  /** 二维码内容（渲染为二维码图片） */
  qrUrl: string;
  /** 轮询 key */
  qrcodeKey: string;
  /** 当前扫码状态码：86101 未扫 / 86102 已扫待确认 / 86090 过期 / 0 成功 */
  status: number;
  /** 是否已登录成功（poll 返回） */
  loggedIn?: boolean;
}

export interface ParseRequest {
  urls?: string[];
  type?: string;
  query?: string;
  keyword?: string;
  weekNum?: number;
  pn?: number;
  pages?: number;
}

export interface DownloadCreateRequest {
  itemIds: string[];
  options?: DownloadOptions;
  force?: boolean;
}

export interface DownloadCreateResult {
  tasks: TaskSummary[];
  duplicates: Array<{ itemId: string; title: string }>;
}