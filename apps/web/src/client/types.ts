/** 客户端与服务端 API 共享的数据形状（与 server 返回 JSON 对应） */

/** 叶子内容大类（与引擎 ItemKind 对齐：容器类型体现在 ParseResultDTO.type） */
export type ItemTypeDTO = "video" | "bangumi" | "cheese" | "lesson" | "audio";

export interface MediaItemDTO {
  id: string;
  type: ItemTypeDTO;
  /** 以下取流标识随类型可选（video 系有 aid/bvid/cid；pgc 有 epId；audio 有 auId/sid 等） */
  aid?: number;
  bvid?: string;
  cid?: number;
  epId?: number;
  auId?: number;
  sid?: number;
  courseId?: number;
  lessonId?: number;
  itemId?: number;
  sectionId?: number;
  /** 互动视频标记 */
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
}

export interface ParseResultDTO {
  type: string;
  title?: string;
  items: MediaItemDTO[];
}

export interface CodecOptionDTO {
  id: number;
  label: string;
}

export interface QualityOptionDTO {
  id: number;
  label: string;
  codecs: CodecOptionDTO[];
}

export interface MediaOptionSummaryDTO {
  itemId: string;
  mediaType: "dash" | "mp4";
  timelength: number;
  qualities: QualityOptionDTO[];
  audioQualities: CodecOptionDTO[];
}

export interface TaskDTO {
  id: string;
  status:
    | "queued"
    | "parsing"
    | "downloading"
    | "merging"
    | "completed"
    | "failed"
    | "cancelled";
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
}

export interface FileEntryDTO {
  name: string;
  path: string;
  size: number;
  mtime: number;
}

export interface DownloadOptionsDTO {
  videoQualityId?: number;
  videoCodecId?: number;
  audioQualityId?: number;
  container?: "mp4" | "mkv";
}

export interface DownloadResponseDTO {
  tasks: TaskDTO[];
  duplicates: Array<{ itemId: string; title: string }>;
}

export interface ApiErrorDTO {
  error: { code: string; message: string; duplicates?: Array<{ itemId: string; title: string }> };
}

export const STATUS_LABEL: Record<TaskDTO["status"], string> = {
  queued: "排队中",
  parsing: "解析中",
  downloading: "下载中",
  merging: "合并中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}
