/** 单个可下载条目的取流/落盘形态（P2：bangumi/cheese/lesson/audio 为各自直链或 PGC 取流） */
export type ItemKind = "video" | "bangumi" | "cheese" | "lesson" | "audio";

/** 叶子条目的来源容器（P3 命名分类用；桌面用 Attribute 位标记同一语义） */
export type ContainerType = "space" | "favlist" | "popular" | "watch_later" | "history" | "list";

/** 单个可下载条目（对应桌面版"解析列表"中一个可勾选项：一个分P/一集/一首歌） */
export interface MediaItem {
  /** 稳定标识，形如 video:BVxxx:p1 / bangumi:BVxxx:ep399341 */
  id: string;
  /** 内容大类（叶子类型即取流 flavor；space/favlist 等容器类型体现在 ParseResult.type） */
  type: ItemKind;
  /** 稿件 aid；音频/商城课等直链条目可为空 */
  aid?: number;
  /** 稿件 bvid；音频/商城课可为空 */
  bvid?: string;
  /** 分P cid；音频/商城课可为空 */
  cid?: number;
  /** PGC/PUGV（番剧/课程）分集 ep_id */
  epId?: number;
  /** 番剧/课程 season_id（ss 编号，命名变量 {season_id} 用） */
  seasonId?: number;
  /** 音频条目 au 编号（音乐服务 song id 别名，用于还原链接） */
  auId?: number;
  /** 音频条目 sid（audio music-service 下载用） */
  sid?: number;
  /** 商城课程编号（lesson） */
  courseId?: number;
  lessonId?: number;
  itemId?: number;
  sectionId?: number;
  /** 互动视频标记（互动视频下载行为等同投稿视频，仅标记差异） */
  interactive?: boolean;
  /** 分P 序号（1 起） */
  page: number;
  /** 分P 标题 */
  title: string;
  /** 视频主标题（合集/分P 时为总标题） */
  groupTitle: string;
  /** 时长（秒） */
  duration: number;
  /** 角标文案，如 "充电专属"；无则空串 */
  badge: string;
  /** 封面 URL */
  cover: string;
  /** 发布时间（Unix 秒） */
  pubtime: number;
  owner: {
    mid: number;
    name: string;
    face: string;
  };
  desc: string;
  /** 可重新打开/复制的地址 */
  url: string;

  // ---------- P3 命名/分类元数据（可选，解析器按来源容器与内容类型填充） ----------
  /** 来源容器（space/favlist/popular/history/watch_later），命名分类优先级最高 */
  containerType?: ContainerType;
  /** 命名用的容器父级标题（popular 期数 / history 等固定标签），缺省回落 groupTitle */
  containerTitle?: string;
  /** 所属稿件总分P 数（≥1；用于 PART vs NORMAL 分类） */
  partCount?: number;

  // 番剧/课程/合集语义字段
  /** 番剧季标题（{season_title}，缺省回落 groupTitle） */
  seasonTitle?: string;
  /** 剧集标题（{episode_title}，缺省回落 title） */
  episodeTitle?: string;
  /** 番剧季号/课程序号（{season_number}/{episode_number}） */
  seasonNumber?: number;
  episodeNumber?: number;
  /** 合集/课节所属分节标题（{section_title}） */
  sectionTitle?: string;
  /** 合集标题（{collection_title}） */
  collectionTitle?: string;
  /** 系列/课程标题（{series_title}，缺省回落 groupTitle） */
  seriesTitle?: string;

  // 收藏夹语义字段（收藏夹主人 ≠ 视频 UP 主）
  /** 收藏夹 media_id（{favorites_id}） */
  favoritesId?: number;
  /** 收藏夹名（{favorites_name}） */
  favoritesName?: string;
  /** 收藏夹主人（{favorites_owner}/{favorites_owner_id}） */
  favoritesOwner?: { mid: number; name: string };
  /** 收藏时间（{fav_time}/{fav_ts}） */
  favtime?: number;
  /** 最近观看时间（{last_watched_time}/{last_watched_ts}） */
  viewtime?: number;
}

