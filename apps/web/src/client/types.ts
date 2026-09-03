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
  /** 附加内容（可选；缺省由服务端与全局默认合并） */
  extras?: ExtrasOptionsDTO;
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

// ==================== 附加内容 / 全局设置（与 server config JSON 对应） ====================

export type DanmakuFormatDTO = "xml" | "ass" | "json";
export type SubtitleFormatDTO = "srt" | "lrc" | "txt" | "ass" | "json";
export type CoverFormatDTO = "jpg" | "png" | "avif" | "webp";
export type MetadataFormatDTO = "nfo" | "json";

export interface DanmakuFontDTO {
  name?: string;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
}

export interface DanmakuStyleDTO {
  font?: DanmakuFontDTO;
  border?: { border?: number; shadow?: number };
  advanced?: {
    displayArea?: number;
    opacity?: number;
    scrollDuration?: number;
    staticDuration?: number;
    minimumGap?: number;
  };
  resolution?: { width?: number; height?: number };
}

export interface SubtitleStyleDTO {
  font?: DanmakuFontDTO;
  border?: { border?: number; shadow?: number };
  color?: { primary?: string; secondary?: string; border?: string; shadow?: string };
  margin?: { left?: number; right?: number; vertical?: number };
  resolution?: { width?: number; height?: number };
  alignment?: number;
}

export interface DanmakuOptionsDTO {
  enabled?: boolean;
  format?: DanmakuFormatDTO;
  embed?: boolean;
  deleteAfterEmbed?: boolean;
  style?: DanmakuStyleDTO;
}

export interface SubtitleLanguageSelectionDTO {
  downloadSpecified?: boolean;
  specifiedLanguages?: string[];
}

export interface SubtitleOptionsDTO {
  enabled?: boolean;
  format?: SubtitleFormatDTO;
  language?: SubtitleLanguageSelectionDTO;
  embed?: boolean;
  deleteAfterEmbed?: boolean;
  style?: SubtitleStyleDTO;
}

export interface CoverOptionsDTO {
  enabled?: boolean;
  format?: CoverFormatDTO;
  attach?: boolean;
  deleteAfterAttach?: boolean;
}

export interface ChapterOptionsDTO {
  embed?: boolean;
}

export interface MetadataOptionsDTO {
  enabled?: boolean;
  format?: MetadataFormatDTO;
}

/** 附加内容（与引擎 ExtrasOptions 同构；所有字段可选以支持部分覆盖） */
export interface ExtrasOptionsDTO {
  danmaku?: DanmakuOptionsDTO;
  subtitle?: SubtitleOptionsDTO;
  cover?: CoverOptionsDTO;
  chapter?: ChapterOptionsDTO;
  metadata?: MetadataOptionsDTO;
}

export interface NamingRuleDTO {
  id: string;
  name: string;
  /** 归属命名分类（ConventionType 数值，见命名类型常量） */
  type: number;
  /** 模板，可含 "/" 生成多级目录；支持 {var} / {var:%Y...} / {var:02d} */
  rule: string;
  default?: boolean;
}

export interface FileNamingConfigDTO {
  rules?: NamingRuleDTO[];
  /** 编号模式：0=指定起始 1=解析列表序号 2=连续编号 */
  numberingType?: number;
  startingNumber?: number;
}

export interface AppConfigDTO {
  additional?: ExtrasOptionsDTO;
  fileNaming?: FileNamingConfigDTO;
}
