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
}

export type TaskStatus =
  | "queued" | "parsing" | "downloading" | "merging"
  | "paused" | "interrupted" | "completed" | "failed" | "cancelled";

export interface DownloadOptions {
  videoQualityId?: number;
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
}

export interface MediaOptionSummary {
  itemId: string;
  mediaType: "dash" | "mp4";
  timelength: number;
  qualities: Array<{ id: number; label: string; codecs: Array<{ id: number; label: string }> }>;
  audioQualities: Array<{ id: number; label: string }>;
}

/** 全局配置（config.ts 的 AppConfig，前端只读/写关心的子集） */
export interface AppConfig {
  behavior: { language: string; theme: string };
  download: {
    dir: string; parallel: number; threads: number; speedLimitKbps: number;
    renamePolicy: string; duplicatePolicy: string; defaultContainer: "mp4" | "mkv";
  };
  additional: Record<string, unknown>;
  fileNaming: { rules: unknown[]; numberingType: number; startingNumber: number };
  advanced: Record<string, unknown>;
}

/** 配置部分更新（与后端 AppConfigPatch 对齐）：组内字段均可缺省 */
export interface AppConfigPatch {
  additional?: Record<string, unknown>;
  fileNaming?: { rules?: unknown[]; numberingType?: number; startingNumber?: number };
  download?: Partial<AppConfig["download"]>;
  behavior?: Partial<AppConfig["behavior"]>;
  advanced?: Record<string, unknown>;
}