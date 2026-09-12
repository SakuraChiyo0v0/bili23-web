import type { HttpClient } from "../api/http.js";
import type { ContentType } from "../url.js";
import type { MediaItem } from "../types.js";

/** 解析执行上下文：携带请求客户端（含 cookie/UA）等共享设施 */
export interface ParseContext {
  http: HttpClient;
}

/** 解析选项（P1 仅占位；P2 起支持 pn/搜索关键词等） */
export interface ParseOptions {
  /** 分页/分P 参数等后续扩展 */
  pn?: number;
  /**
   * 互动视频（`rights.is_stein_gate === 1`）是否直接 BFS 展开全部分支节点。
   *
   * 默认 `true`（调用方拿到可下载条目）。置 `false` 时只回报
   * `interactiveDetected: true` 并返回稿件本身的分P，**不展开**分支节点 ——
   * 对应桌面先弹「检测到互动视频，请选择操作」、用户确认后才走
   * INTERACTIVE_VIDEO 二次解析（`parser/video.py:265-268`）。
   */
  expandInteractiveNodes?: boolean;
  /**
   * 忽略 `ugc_season`（合集），只解析稿件自己的分P。
   *
   * 对应原版 `MultiPartListsDialog` 里那句 `del info_data["data"]["ugc_season"]`：
   * 要的是"这个视频的分P 列表"，不是它所属的整个合集。
   */
  ignoreSeason?: boolean;
}

/** 链接指向项的比对键（对齐桌面 `current_episode_data` 的 key） */
export type LinkTargetKey = "cid" | "ep_id" | "section_id";

/**
 * 链接所指向的那一项。
 *
 * 对应桌面版解析完投给界面的 `current_episode_data = (key, value)`：
 * 投稿视频用 `cid`（`episode/video.py:get_cid`）、剧集/课程用 `ep_id`
 * （`episode/bangumi.py:get_ep_id`）、会员购课程用 `section_id`
 * （`episode/lesson.py:get_section_id`）。
 *
 * 用途有二：解析后**条件式自动勾选**要勾中它；媒体信息预览要拿它当首选。
 */
export interface LinkTarget {
  key: LinkTargetKey;
  value: number;
}

/** 解析结果：条目列表 + 可选元信息 */
export interface ParseResult {
  type: ContentType;
  /** 结果主标题（页面展示用） */
  title?: string;
  /** 可下载条目（勾选/下载的最小单位） */
  items: MediaItem[];
  /** 内容发生了跳转（如视频被重定向到其他地址），调用方应改用该地址重新解析 */
  redirectUrl?: string;
  /** 分页信息（合集/系列/空间等列表型返回） */
  pagination?: { total: number; page: number; pageSize: number; totalPages: number };
  /** 链接指向的那一项；列表型（空间/收藏夹/历史等）没有这一项 */
  target?: LinkTarget;
  /**
   * 命中互动视频、且**尚未**展开分支节点（调用方应确认后再带
   * `expandInteractiveNodes: false` 之外的方式重新解析）。
   * 对应桌面 `signal_bus.parse.show_interactive_video_dialog`。
   */
  interactiveDetected?: boolean;
}

export interface Parser {
  parse(ctx: ParseContext, url: string, options?: ParseOptions): Promise<ParseResult>;
}
