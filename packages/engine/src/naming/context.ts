import type { MediaItem } from "../types.js";
import { ConventionType, type ConventionTypeId, DATETIME_VARIABLES } from "./variables.js";

/** 命名时使用的档位展示信息（下载解析后回填，语义对应桌面 Episode.video_quality 等） */
export interface NamingQuality {
  /** 如 "1080P"、"720P" */
  videoQuality: string;
  /** 如 "192K"、"64K"；无音频流时为 "" */
  audioQuality: string;
  /** 如 "HEVC"、"AVC"、"AV1"；单文件/无视频时为 "" */
  videoCodec: string;
}

/** 变量表：命名模板求值所需全部键（缺失键给 ""，避免模板抛错） */
export type NamingVariables = Record<string, string | number>;

/** 判定叶子条目的命名分类（对应桌面 Attribute 位 → ConventionType 的优先级顺序） */
export function resolveConventionType(item: MediaItem): ConventionTypeId {
  // 来源容器优先（桌面 Attribute：FAVLIST/SPACE/HISTORY/WATCH_LATER/WEEKLY/AUDIO 位优先于 NORMAL/PART）
  switch (item.containerType) {
    case "favlist":
      return ConventionType.FAVORITE;
    case "space":
      return ConventionType.SPACE;
    case "history":
      return ConventionType.HISTORY;
    case "watch_later":
      return ConventionType.WATCH_LATER;
    case "popular":
      return ConventionType.WEEKLY;
    default:
      break;
  }

  switch (item.type) {
    case "audio":
      return ConventionType.AUDIO;
    case "bangumi":
      return ConventionType.BANGUMI;
    case "cheese":
      return ConventionType.CHEESE;
    case "lesson":
      return ConventionType.LESSON;
    case "video":
      if (item.interactive) return ConventionType.INTERACTIVE_VIDEO;
      // 多分P → PART；单分P → NORMAL（与桌面 PART/NORMAL 位语义一致）
      return (item.partCount ?? 1) > 1 ? ConventionType.PART : ConventionType.NORMAL;
    default:
      return ConventionType.NORMAL;
  }
}

/** 文件名里展示用的上传者（歌曲场景为歌手；owner.name 为空回落 mid 占位） */
function uploaderName(item: MediaItem): string {
  return item.owner.name;
}

/**
 * 组装命名变量表。
 * 语义对齐桌面 FileNameFormatter.get_variable_data_from_task_info：
 * 全部键都给默认值（数字 0 / 文本 ""），缺数据的变量不抛错、在路径里自然消失。
 */
export function buildNamingVariables(
  item: MediaItem,
  quality: NamingQuality,
  number: string | number,
  createdTime: number,
): NamingVariables {
  const { videoQuality, audioQuality, videoCodec } = quality;
  const time = (ts?: number): number => (ts && ts > 0 ? ts : 0);

  const vars: NamingVariables = {
    // 时间（Unix 秒；模板中 *_time 变量可再 strftime）
    pub_time: time(item.pubtime),
    pub_ts: time(item.pubtime),
    create_time: createdTime,
    create_ts: createdTime,
    fav_time: time(item.favtime),
    fav_ts: time(item.favtime),
    last_watched_time: time(item.viewtime),
    last_watched_ts: time(item.viewtime),
    number,

    // 上传者
    uploader: uploaderName(item),
    uploader_uid: item.owner.mid || "",

    // 档位
    video_quality: videoQuality,
    audio_quality: audioQuality,
    video_codec: videoCodec,

    // 稿件标识
    aid: item.aid ?? "",
    bvid: item.bvid ?? "",
    cid: item.cid ?? "",
    ep_id: item.epId ?? "",
    season_id: item.seasonId ?? "",

    // 课程标识
    course_id: item.courseId ?? "",
    lesson_id: item.lessonId ?? "",
    item_id: item.itemId ?? "",
    section_id: item.sectionId ?? "",

    // 标题类
    leaf_title: item.title,
    parent_title: item.containerTitle ?? item.groupTitle,
    section_title: item.sectionTitle ?? "",
    collection_title: item.collectionTitle ?? "",
    series_title: item.seriesTitle ?? item.groupTitle,
    season_title: item.seasonTitle ?? item.groupTitle,
    episode_title: item.episodeTitle ?? item.title,

    // 序号类
    season_number: item.seasonNumber ?? "",
    episode_number: item.episodeNumber ?? "",
    p: item.page,
    part_number: item.page,

    // 收藏夹
    favorites_name: item.favoritesName ?? "",
    favorites_id: item.favoritesId ?? "",
    favorites_owner: item.favoritesOwner?.name ?? "",
    favorites_owner_id: item.favoritesOwner?.mid ?? "",

    // 空间
    space_owner: item.owner.name,
    space_owner_id: item.owner.mid || "",
  };

  // 时间占位键也放进变量表（模板引用 {pub_time} 不带格式时输出时间戳文本）
  for (const key of DATETIME_VARIABLES) {
    if (vars[key] !== undefined) continue;
    vars[key] = 0;
  }
  return vars;
}

