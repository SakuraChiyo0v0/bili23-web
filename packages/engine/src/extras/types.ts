import type { ParseContext } from "../parser/types.js";
import type { MediaItem } from "../types.js";

/**
 * 附加内容（extras）模块类型与默认值。
 * 语义对齐桌面版 Bili23-Downloader v2.15.0：
 * - 格式联合类型对应 util/common/enum.py 的 DanmakuType/SubtitleType/CoverType/MetadataType；
 * - 选项字段对应 config.py “Additional” 分组（download_*、embed_*、delete_*_after_*、attach_cover 等）；
 * - 样式默认值对应 config.py DefaultValue.danmaku_style / subtitle_style（逐字拷贝）。
 */

// ---------- 格式联合类型 ----------

export type DanmakuFormat = "xml" | "ass" | "json";
export type SubtitleFormat = "srt" | "lrc" | "txt" | "ass" | "json";
export type CoverFormat = "jpg" | "png" | "avif" | "webp";
export type MetadataFormat = "nfo" | "json";

// ---------- 弹幕/字幕样式（默认值与上游一致） ----------

export interface DanmakuFont {
  /** 字体名，默认 "黑体" */
  name: string;
  /** 字号（像素），默认 36 */
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  /** 删除线 */
  strike: boolean;
}

export interface DanmakuStyle {
  font: DanmakuFont;
  border: {
    /** 描边宽度，默认 1.0 */
    border: number;
    /** 阴影深度，默认 0 */
    shadow: number;
  };
  advanced: {
    /** 显示区域占屏高百分比，默认 60 */
    displayArea: number;
    /** 不透明度百分比，默认 80 */
    opacity: number;
    /** 滚动弹幕时长（秒），默认 10 */
    scrollDuration: number;
    /** 顶部/底部固定弹幕时长（秒），默认 5 */
    staticDuration: number;
    /** 相邻弹幕最小间距（像素），默认 100 */
    minimumGap: number;
  };
  resolution: {
    width: number;
    height: number;
  };
}

export interface SubtitleStyle {
  font: DanmakuFont;
  border: {
    border: number;
    shadow: number;
  };
  color: {
    /** ASS 主色（&HAABBGGRR），默认 "&H00FFFFFF" */
    primary: string;
    /** 次要色，默认 "&H000000FF" */
    secondary: string;
    /** 描边色，上游默认 "H00000000"（无 & 前缀，逐字保留） */
    border: string;
    /** 阴影色，上游默认 "H00000000" */
    shadow: string;
  };
  margin: {
    left: number;
    right: number;
    vertical: number;
  };
  resolution: {
    width: number;
    height: number;
  };
  /** ASS Alignment（2=底部居中，默认 2） */
  alignment: number;
}

/** 弹幕样式默认值（config.py DefaultValue.danmaku_style） */
export const DEFAULT_DANMAKU_STYLE: DanmakuStyle = {
  font: { name: "黑体", size: 36, bold: false, italic: false, underline: false, strike: false },
  border: { border: 1.0, shadow: 0 },
  advanced: { displayArea: 60, opacity: 80, scrollDuration: 10, staticDuration: 5, minimumGap: 100 },
  resolution: { width: 1280, height: 720 },
};

/** 字幕样式默认值（config.py DefaultValue.subtitle_style） */
export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  font: { name: "黑体", size: 36, bold: false, italic: false, underline: false, strike: false },
  border: { border: 1.0, shadow: 0.0 },
  color: { primary: "&H00FFFFFF", secondary: "&H000000FF", border: "H00000000", shadow: "H00000000" },
  margin: { left: 10, right: 10, vertical: 20 },
  resolution: { width: 1280, height: 720 },
  alignment: 2,
};

// ---------- 字幕语言选择 ----------

export interface SubtitleLanguageSelection {
  /** 是否只下载指定语言（对应上游 subtitle_language.download_specified） */
  downloadSpecified: boolean;
  /** 指定下载的语言码列表（对应上游 specified_language，B 站 lan 取值如 zh/en/ai-zh） */
  specifiedLanguages: string[];
}

export const DEFAULT_SUBTITLE_LANGUAGE: SubtitleLanguageSelection = {
  downloadSpecified: false,
  specifiedLanguages: [],
};

// ---------- 各附加类别选项（对应 config.py “Additional” 分组） ----------

export interface DanmakuOptions {
  /** 是否下载弹幕（download_danmaku） */
  enabled: boolean;
  /** 输出格式（danmaku_type），默认 ass */
  format: DanmakuFormat;
  /** 弹幕样式（danmaku_style），ASS 输出与内嵌共用 */
  style: DanmakuStyle;
  /** 是否作为字幕轨内嵌进 MKV（embed_danmaku）；仅 ASS 且输出 MKV 时生效 */
  embed: boolean;
  /** 内嵌成功后是否删除源 .ass 文件（delete_danmaku_after_embed） */
  deleteAfterEmbed: boolean;
}

export interface SubtitleOptions {
  /** 是否下载字幕（download_subtitle） */
  enabled: boolean;
  /** 输出格式（subtitle_type），默认 ass */
  format: SubtitleFormat;
  /** 语言选择（subtitle_language） */
  language: SubtitleLanguageSelection;
  /** 字幕样式（subtitle_style），ASS 输出与内嵌共用 */
  style: SubtitleStyle;
  /** 是否作为字幕轨内嵌进 MKV（embed_subtitle） */
  embed: boolean;
  /** 内嵌成功后是否删除源文件（delete_subtitle_after_embed） */
  deleteAfterEmbed: boolean;
}

export interface CoverOptions {
  /** 是否下载封面（download_cover） */
  enabled: boolean;
  /** 输出格式（cover_type），默认 jpg */
  format: CoverFormat;
  /** 是否把封面 attach 进最终媒体文件（attach_cover） */
  attach: boolean;
  /** attach 成功后是否删除源图片（delete_cover_after_attach） */
  deleteAfterAttach: boolean;
}

export interface ChapterOptions {
  /** 是否内嵌章节信息（embed_chapter）；章节来自播放器接口 view_points */
  embed: boolean;
}

export interface MetadataOptions {
  /** 是否下载元数据（download_metadata） */
  enabled: boolean;
  /** 输出格式（metadata_type），默认 nfo */
  format: MetadataFormat;
}

/** 附加内容整体选项（JSON 可序列化；undefined 分组表示沿用默认） */
export interface ExtrasOptions {
  danmaku?: DanmakuOptions;
  subtitle?: SubtitleOptions;
  cover?: CoverOptions;
  chapter?: ChapterOptions;
  metadata?: MetadataOptions;
}

/** 附加内容选项默认值（与 config.py “Additional” 分组默认一致） */
export const DEFAULT_EXTRAS_OPTIONS: ExtrasOptions = {
  danmaku: {
    enabled: false,
    format: "ass",
    style: DEFAULT_DANMAKU_STYLE,
    embed: false,
    deleteAfterEmbed: false,
  },
  subtitle: {
    enabled: false,
    format: "ass",
    language: DEFAULT_SUBTITLE_LANGUAGE,
    style: DEFAULT_SUBTITLE_STYLE,
    embed: false,
    deleteAfterEmbed: false,
  },
  cover: { enabled: false, format: "jpg", attach: false, deleteAfterAttach: false },
  chapter: { embed: false },
  metadata: { enabled: false, format: "nfo" },
};

// ---------- 附加上下文（供上层下载管线在合并后调用） ----------

/** 附加文件输出目标（文件名 stem + 目标目录，来自命名层） */
export interface ExtrasTarget {
  /** 主文件名 stem（不含扩展名），如 "P1-分P标题" */
  stem: string;
  /** 目标目录（download_path/folder），附加文件写到这里 */
  dir: string;
}

/** 画质/编码标签（预留；上层有则填，没有则省略） */
export interface ExtrasQuality {
  videoQuality?: string;
  audioQuality?: string;
  videoCodec?: string;
}

/** 执行附加内容所需的完整输入 */
export interface ExtrasContext {
  /** 网络请求设施（含 cookie/UA），复用解析上下文 */
  http: ParseContext["http"];
  /** 视频条目（cid/bvid/aid/cover/pubtime/owner 等） */
  item: MediaItem;
  /** 附加内容选项 */
  options: ExtrasOptions;
  /** 文件名 stem + 目标目录 */
  target: ExtrasTarget;
  /** 合并后的容器（决定 ASS 字幕轨能否内嵌；mkv 支持，mp4 不支持） */
  container?: "mp4" | "mkv";
  /** 画质标签（预留） */
  quality?: ExtrasQuality;
}

// ---------- 归一化数据结构（转换/生成器共享） ----------

/** 单条弹幕（对齐桌面 protobuf → dict 后的字段名；stime 单位毫秒） */
export interface DanmakuEntry {
  /** 弹幕在视频中的位置（毫秒） */
  stime: number;
  /** 弹幕模式：1-3 滚动、4 底部、5 顶部 */
  mode: number;
  /** 字号（像素），默认 25 */
  size: number;
  /** 颜色（十进制 RGB），默认 16777215（白） */
  color: number;
  /** 发送时间（Unix 秒） */
  date: number;
  /** 发送人 mid hash */
  uhash: string;
  /** 弹幕 dmid（字符串） */
  dmid: string;
  /** 弹幕文本 */
  text: string;
  /** 权重（protobuf 有该字段时保留；XML 来源第 9 个 p 字段） */
  weight?: number;
}

/** B 站字幕条目（播放器信息 subtitle.subtitles 中的一项） */
export interface SubtitleInfo {
  /** 语言码（BCP-47 风格，如 zh/ai-zh/zh-Hant） */
  lan: string;
  /** 可读语言名，如 "中文（简体）"；缺省回落 lan */
  lanDoc?: string;
  /** 字幕 JSON 相对地址（以 // 开头） */
  subtitleUrl: string;
}

/** 字幕 JSON 正文（subtitle_url 下载结果） */
export interface SubtitleJson {
  /** 逐条字幕（from/to 单位为秒） */
  body?: Array<{ from?: number; to?: number; content?: string; location?: number }>;
  [key: string]: unknown;
}

/** 播放器信息（x/player/wbi/v2 data）：字幕列表 + 章节共用一次请求 */
export interface PlayerInfo {
  subtitle?: { subtitles?: SubtitleInfo[] };
  /** 分段章节（view_points），from/to 单位为秒 */
  view_points?: Array<{ from?: number; to?: number; content?: string }>;
  [key: string]: unknown;
}

/** 元数据模板输入（NFO/JSON 共用；由上层从 MediaItem + 季/剧信息组装） */
export interface MetadataInput {
  kind: "video" | "bangumi" | "cheese" | "lesson";
  /** 展示主标题：投稿视频用稿件主标题，剧集用剧集标题 */
  showTitle: string;
  /** 简介 */
  description: string;
  /** 时长（秒） */
  durationSec: number;
  /** 发布时间（Unix 秒） */
  pubtime: number;
  /** 封面 URL */
  cover: string;
  /** 剧集海报 URL（tvshow thumb） */
  poster?: string;
  owner: { mid: number; name: string; face: string };
  bvid?: string;
  /** 番剧/课程 ss 编号 */
  seasonId?: number;
  /** 分集 ep_id */
  epId?: number;
  /** 剧集序号（episode_number） */
  episodeNumber?: number;
  /** 季标题（season_title） */
  seasonTitle?: string;
  /** 剧集标题（episode_title，缺省回落 showTitle） */
  episodeTitle?: string;
  /** 剧集首播时间（Unix 秒，tvshow premiered；缺省回落 pubtime） */
  premiered?: number;
  /** 剧集风格（genres） */
  genres?: string[];
  /** 剧集地区（areas） */
  areas?: string[];
  /** 评分（有则输出 ratings 块） */
  rating?: number;
  /** 评分人数 */
  ratingVotes?: number;
  /** 连载状态：true=Ongoing，false/缺省=Ended */
  newEpStatus?: boolean;
  /** 投稿视频 tag 列表（从 view/detail/tag 接口取） */
  tags?: string[];
}

/** 单个 NFO 输出（name+qualifier 组合成文件名，qualifier 可为空） */
export interface NfoOutput {
  name: string;
  qualifier: string[];
  contents: string;
}

/** 附加文件英文限定词（桌面 translate() 源字符串；文件命名不随 UI 语言变化） */
export const EXTRA_QUALIFIER = {
  danmaku: "Danmaku",
  subtitles: "Subtitles",
  metadata: "Metadata",
} as const;
