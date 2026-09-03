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
export type ExtraStyle = Record<string, unknown>;

export interface ExtrasOptions {
  danmaku?: {
    enabled: boolean;
    format: DanmakuFormat;
    style?: ExtraStyle;
    embed?: boolean;
    deleteAfterEmbed?: boolean;
  };
  subtitle?: {
    enabled: boolean;
    format: SubtitleFormat;
    language?: ExtraStyle;
    style?: ExtraStyle;
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