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
}

export interface Parser {
  parse(ctx: ParseContext, url: string, options?: ParseOptions): Promise<ParseResult>;
}
