/**
 * 命名规则常量与默认配置。
 * 数值/默认规则/变量目录与桌面版对齐：
 * - 类型编号 src/util/common/enum.py ConventionType
 * - 默认规则 src/util/common/config.py DefaultValue.naming_rule_list
 * - 变量目录 src/util/common/data/naming_convention.py VariableListFactory
 */

/** 命名分类（ConventionType 数值，桌面 IntEnum 语义） */
export const ConventionType = {
  NORMAL: 11,
  PART: 12,
  COLLECTION: 13,
  INTERACTIVE_VIDEO: 14,
  BANGUMI: 20,
  CHEESE: 30,
  LESSON: 31,
  FAVORITE: 40,
  SPACE: 50,
  HISTORY: 60,
  WATCH_LATER: 70,
  WEEKLY: 80,
  AUDIO: 90,
} as const;

export type ConventionTypeId = (typeof ConventionType)[keyof typeof ConventionType];

/** 一条命名规则（config.json naming_rule_list 的元素，结构对齐桌面） */
export interface NamingRule {
  id: string;
  name: string;
  /** 归属 ConventionType 数值 */
  type: ConventionTypeId;
  /** 模板（可含 "/" 生成多级目录；支持 {var} / {var:%Y...} / {var:0Nd}） */
  rule: string;
  default: boolean;
}

/** 变量目录条目（供设置页插入/预览） */
export interface NamingVariable {
  name: string;
  variable: string;
  description: string;
  example: string | number;
  /** "text" | "datetime" | "number"（对齐桌面 VariableType） */
  kind: "text" | "datetime" | "number";
}

/** 时间类变量（值以 Unix 秒记，模板写 {var:%Y-%m-%d...} 时按 strftime 子集格式化） */
export const DATETIME_VARIABLES: ReadonlySet<string> = new Set([
  "pub_time",
  "create_time",
  "fav_time",
  "last_watched_time",
]);

/** 通用（基础）变量：全部命名分类可用 */
export const BASE_VARIABLES: NamingVariable[] = [
  { name: "pub_time", variable: "{pub_time:%Y-%m-%d_%H-%M-%S}", description: "发布时间", example: "2026-03-07_12-00-00", kind: "datetime" },
  { name: "pub_ts", variable: "{pub_ts}", description: "发布时间戳", example: "1772841600", kind: "text" },
  { name: "create_time", variable: "{create_time:%Y-%m-%d_%H-%M-%S}", description: "任务创建时间", example: "2026-03-07_12-00-00", kind: "datetime" },
  { name: "create_ts", variable: "{create_ts}", description: "任务创建时间戳", example: "1772841600", kind: "text" },
  { name: "number", variable: "{number}", description: "下载编号", example: 1, kind: "number" },
  { name: "uploader", variable: "{uploader}", description: "UP 主昵称", example: "UP主昵称", kind: "text" },
  { name: "uploader_uid", variable: "{uploader_uid}", description: "UP 主 UID", example: "12345678", kind: "text" },
  { name: "video_quality", variable: "{video_quality}", description: "画质", example: "1080P", kind: "text" },
  { name: "audio_quality", variable: "{audio_quality}", description: "音质", example: "192K", kind: "text" },
  { name: "video_codec", variable: "{video_codec}", description: "编码", example: "HEVC", kind: "text" },
];

/** 通用标识变量（带 aid/bvid/cid 的条目可用） */
export const ID_VARIABLES: NamingVariable[] = [
  { name: "aid", variable: "{aid}", description: "稿件 aid", example: "1555921697", kind: "text" },
  { name: "bvid", variable: "{bvid}", description: "稿件 bvid", example: "BV1r1421r78r", kind: "text" },
  { name: "cid", variable: "{cid}", description: "分P cid", example: "1599644073", kind: "text" },
];

/** 各命名分类的扩展变量目录（不含基础/标识变量） */
export const TYPE_VARIABLES: Partial<Record<ConventionTypeId, NamingVariable[]>> = {
  [ConventionType.NORMAL]: [
    { name: "leaf_title", variable: "{leaf_title}", description: "视频标题", example: "游戏科学新作《黑神话：钟馗》先导预告", kind: "text" },
  ],
  [ConventionType.PART]: [
    { name: "parent_title", variable: "{parent_title}", description: "主视频标题", example: "【KEY社20周年音乐专辑】Key BEST SELECTION", kind: "text" },
    { name: "p", variable: "{p}", description: "分P 序号", example: 4, kind: "number" },
    { name: "leaf_title", variable: "{leaf_title}", description: "分P 标题", example: "04 アルカテイル", kind: "text" },
  ],
  [ConventionType.COLLECTION]: [
    { name: "collection_title", variable: "{collection_title}", description: "合集标题", example: "艾尔登法环白金攻略", kind: "text" },
    { name: "section_title", variable: "{section_title}", description: "分节标题", example: "DLC黄金树幽影", kind: "text" },
    { name: "parent_title", variable: "{parent_title}", description: "视频标题", example: "全收集、全流程、全剧情攻略", kind: "text" },
    { name: "leaf_title", variable: "{leaf_title}", description: "分P 标题", example: "03【墓地平原-西+艾拉克河】", kind: "text" },
    { name: "p", variable: "{p}", description: "分P 序号", example: 3, kind: "number" },
  ],
  [ConventionType.INTERACTIVE_VIDEO]: [
    { name: "leaf_title", variable: "{leaf_title}", description: "节点标题", example: "序幕", kind: "text" },
    { name: "parent_title", variable: "{parent_title}", description: "互动视频主标题", example: "【互动视频】你能逃出这个房间吗？", kind: "text" },
  ],
  [ConventionType.BANGUMI]: [
    { name: "series_title", variable: "{series_title}", description: "系列标题", example: "轻音少女", kind: "text" },
    { name: "season_title", variable: "{season_title}", description: "季标题", example: "轻音少女 第二季", kind: "text" },
    { name: "section_title", variable: "{section_title}", description: "分节标题", example: "正片", kind: "text" },
    { name: "episode_title", variable: "{episode_title}", description: "剧集标题", example: "第18话 主角！", kind: "text" },
    { name: "season_number", variable: "{season_number}", description: "季号", example: 2, kind: "number" },
    { name: "episode_number", variable: "{episode_number}", description: "集号", example: 18, kind: "number" },
    { name: "ep_id", variable: "{ep_id}", description: "分集 ep_id", example: "21296", kind: "text" },
    { name: "season_id", variable: "{season_id}", description: "季 season_id", example: "1173", kind: "text" },
  ],
  [ConventionType.CHEESE]: [
    { name: "series_title", variable: "{series_title}", description: "课程标题", example: "清华梁爽：0-N1日语精讲高级班", kind: "text" },
    { name: "section_title", variable: "{section_title}", description: "分节标题", example: "先导片", kind: "text" },
    { name: "episode_title", variable: "{episode_title}", description: "课节标题", example: "【先导片】……", kind: "text" },
    { name: "ep_id", variable: "{ep_id}", description: "课节 ep_id", example: "158662", kind: "text" },
    { name: "season_id", variable: "{season_id}", description: "课程 season_id", example: "4016", kind: "text" },
  ],
  [ConventionType.LESSON]: [
    { name: "series_title", variable: "{series_title}", description: "课程标题", example: "《男性生活化减脂》课程", kind: "text" },
    { name: "section_title", variable: "{section_title}", description: "分节标题", example: "第一章 入门", kind: "text" },
    { name: "episode_title", variable: "{episode_title}", description: "课节标题", example: "DAY1运动-全身燃脂", kind: "text" },
    { name: "course_id", variable: "{course_id}", description: "课程 ID", example: "1000625147", kind: "text" },
    { name: "lesson_id", variable: "{lesson_id}", description: "课节 ID", example: "180281190609920", kind: "text" },
    { name: "item_id", variable: "{item_id}", description: "课时 ID", example: "10302975", kind: "text" },
    { name: "section_id", variable: "{section_id}", description: "章节 ID", example: "180281190650881", kind: "text" },
  ],
  [ConventionType.FAVORITE]: [
    { name: "parent_title", variable: "{parent_title}", description: "视频标题", example: "【KEY社20周年音乐专辑】Key BEST SELECTION", kind: "text" },
    { name: "favorites_name", variable: "{favorites_name}", description: "收藏夹名称", example: "默认收藏夹", kind: "text" },
    { name: "favorites_id", variable: "{favorites_id}", description: "收藏夹 ID", example: "12345678", kind: "text" },
    { name: "favorites_owner", variable: "{favorites_owner}", description: "收藏夹主人", example: "用户昵称", kind: "text" },
    { name: "favorites_owner_id", variable: "{favorites_owner_id}", description: "收藏夹主人 UID", example: "12345678", kind: "text" },
    { name: "fav_time", variable: "{fav_time:%Y-%m-%d_%H-%M-%S}", description: "收藏时间", example: "2026-03-07_12-00-00", kind: "datetime" },
    { name: "fav_ts", variable: "{fav_ts}", description: "收藏时间戳", example: "1772841600", kind: "text" },
  ],
  [ConventionType.SPACE]: [
    { name: "space_owner", variable: "{space_owner}", description: "空间主人", example: "用户昵称", kind: "text" },
    { name: "space_owner_id", variable: "{space_owner_id}", description: "空间主人 UID", example: "12345678", kind: "text" },
  ],
  [ConventionType.HISTORY]: [
    { name: "parent_title", variable: "{parent_title}", description: "父级标题（历史记录）", example: "历史记录", kind: "text" },
    { name: "leaf_title", variable: "{leaf_title}", description: "视频标题", example: "游戏科学新作《黑神话：钟馗》先导预告", kind: "text" },
    { name: "last_watched_time", variable: "{last_watched_time:%Y-%m-%d_%H-%M-%S}", description: "最近观看时间", example: "2026-03-07_12-00-00", kind: "datetime" },
    { name: "last_watched_ts", variable: "{last_watched_ts}", description: "最近观看时间戳", example: "1772841600", kind: "text" },
  ],
  [ConventionType.WATCH_LATER]: [
    { name: "parent_title", variable: "{parent_title}", description: "父级标题（稍后再看）", example: "稍后再看", kind: "text" },
    { name: "leaf_title", variable: "{leaf_title}", description: "视频标题", example: "游戏科学新作《黑神话：钟馗》先导预告", kind: "text" },
    { name: "fav_time", variable: "{fav_time:%Y-%m-%d_%H-%M-%S}", description: "收藏时间", example: "2026-03-07_12-00-00", kind: "datetime" },
    { name: "fav_ts", variable: "{fav_ts}", description: "收藏时间戳", example: "1772841600", kind: "text" },
  ],
  [ConventionType.WEEKLY]: [
    { name: "parent_title", variable: "{parent_title}", description: "父级标题（期数）", example: "第377期(0612更新)", kind: "text" },
    { name: "leaf_title", variable: "{leaf_title}", description: "视频标题", example: "游戏科学新作《黑神话：钟馗》先导预告", kind: "text" },
  ],
  [ConventionType.AUDIO]: [
    { name: "pub_time", variable: "{pub_time:%Y-%m-%d_%H-%M-%S}", description: "发布时间", example: "2026-03-07_12-00-00", kind: "datetime" },
    { name: "leaf_title", variable: "{leaf_title}", description: "歌曲名称", example: "歌曲名称", kind: "text" },
    { name: "uploader", variable: "{uploader}", description: "歌手", example: "歌手", kind: "text" },
    { name: "parent_title", variable: "{parent_title}", description: "歌单名称", example: "歌单名称", kind: "text" },
    { name: "audio_quality", variable: "{audio_quality}", description: "音质", example: "192K", kind: "text" },
  ],
};

/** 默认命名规则（13 条，rule 与桌面 config.py DefaultValue 一致） */
export const DEFAULT_NAMING_RULES: NamingRule[] = [
  { id: "a024c20c-5826-4e65-a1f5-802e3e2dbe4f", name: "DEFAULT_FOR_NORMAL", type: 11, rule: "{leaf_title}", default: true },
  { id: "2d98a265-e8e1-4b2a-8133-76bbc65c90fe", name: "DEFAULT_FOR_PART", type: 12, rule: "{parent_title}/P{p}-{leaf_title}", default: true },
  { id: "307906bd-86a2-4b6b-bd75-152a8c3e280b", name: "DEFAULT_FOR_COLLECTION", type: 13, rule: "{collection_title}/{section_title}/{parent_title}/{leaf_title}", default: true },
  { id: "1fe25f91-caf0-437e-b132-c9367261ff8b", name: "DEFAULT_FOR_INTERACTIVE_VIDEO", type: 14, rule: "{parent_title}/{leaf_title}", default: true },
  { id: "b1d4e8e3-ca17-4b41-87cf-cda45254701e", name: "DEFAULT_FOR_BANGUMI", type: 20, rule: "{season_title}/{episode_title}", default: true },
  { id: "d582ec37-d8c2-44cf-bbd7-b709ea5c2042", name: "DEFAULT_FOR_CHEESE", type: 30, rule: "{series_title}/{episode_title}", default: true },
  { id: "b7a4f0c5-1d2e-4a83-9f61-3c0d7e5b8a19", name: "DEFAULT_FOR_LESSON", type: 31, rule: "{series_title}/{episode_title}", default: true },
  { id: "5913e25f-0bf3-4d3c-a608-8416af778a8a", name: "DEFAULT_FOR_FAVORITE", type: 40, rule: "{favorites_owner_id}_{favorites_owner}/{favorites_name}/{leaf_title}", default: true },
  { id: "8c48ac82-14c5-4d48-9de7-225d9b53513f", name: "DEFAULT_FOR_SPACE", type: 50, rule: "{space_owner_id}_{space_owner}/{leaf_title}", default: true },
  { id: "307ccc8e-ad2f-4195-94f0-162ee9ff1ac0", name: "DEFAULT_FOR_HISTORY", type: 60, rule: "{parent_title}/{leaf_title}", default: true },
  { id: "0a72a82b-5684-448e-9db1-a342de933d3e", name: "DEFAULT_FOR_WATCH_LATER", type: 70, rule: "{parent_title}/{leaf_title}", default: true },
  { id: "4d28285d-65ca-4c5c-bbb3-b3b5b570c52a", name: "DEFAULT_FOR_WEEKLY", type: 80, rule: "{parent_title}/{leaf_title}", default: true },
  { id: "dc77bd15-be21-4847-856e-68bb3035042f", name: "DEFAULT_FOR_AUDIO", type: 90, rule: "{parent_title}/{uploader} - {leaf_title}", default: true },
];

/** 某分类可用的完整变量目录（基础 + 标识 + 分类扩展；AUDIO 特殊：无 aid/bvid/cid） */
export function variablesFor(type: ConventionTypeId): NamingVariable[] {
  const extra = TYPE_VARIABLES[type] ?? [];
  if (type === ConventionType.AUDIO) return extra;
  return [...BASE_VARIABLES, ...ID_VARIABLES, ...extra];
}
