import { BiliError } from "../errors.js";
import { wbiSign } from "../api/wbi.js";
import { ensureWbiKeys } from "../media/wbi-keys.js";
import { isLoginApiError } from "../media/video-info.js";
import type { ParseContext } from "../parser/types.js";
import type {
  CoverFormat,
  PlayerInfo,
  SubtitleInfo,
  SubtitleJson,
  SubtitleLanguageSelection,
} from "./types.js";

/**
 * 附加内容网络层。
 * 端点与参数逐字对照桌面 util/parse/additional/：
 * - 弹幕：采用 B 站标准 XML 端点 comment.bilibili.com/{cid}.xml（无登录、免 wbi）；
 * - 播放器信息：x/player/wbi/v2（WBI 签名，dm_img_* 风控参数与上游一致），字幕列表与章节共用；
 * - 字幕正文：subtitle_url 前补 https:；
 * - 封面：封面 URL 追加 @.{format} 交给 B 站图床转码；
 * - 元数据视频 tag：x/web-interface/view/detail/tag?bvid=。
 */

const DM_IMG_STR = "V2ViR0wgMS4wIChPcGVuR0wgRVMgMi4wIENocm9taXVtKQ";
const DM_COVER_IMG_STR =
  "QU5HTEUgKE5WSURJQSwgTlZJRElBIEdlRm9yY2UgUlRYIDQwNjAgTGFwdG9wIEdQVSAoMHgwMDAwMjhFMCkgRGlyZWN0M0QxMSB2c181XzAgcHNfNV8wLCBEM0QxMSlHb29nbGUgSW5jLiAoTlZJRElBKQ";
const DM_IMG_INTER = '{"ds":[],"wh":[5231,6067,75],"of":[475,950,475]}';

/** 弹幕 XML 接口响应 */
interface DanmakuResponse {
  code: number;
  message?: string;
  data?: PlayerInfo;
}

function assertOk(body: DanmakuResponse, fallback: string): void {
  if (body.code !== 0) {
    if (isLoginApiError(body.code, body.message)) {
      throw new BiliError("LOGIN_REQUIRED", body.message ?? "需要登录", { apiCode: body.code });
    }
    throw new BiliError("API_ERROR", body.message ?? fallback, { apiCode: body.code });
  }
}

/**
 * 拉取弹幕 XML（B 站标准弹幕 XML，含 <d p="..."> 条目）。
 * 行为基准说明：桌面版 v2.15.0 走 protobuf(seg.so) 再自行生成 XML/ASS/JSON；
 * 本引擎为满足零新增运行时依赖，改为直接拉取 B 站标准 XML 端点，再由 danmaku-* 生成器
 * 解析后产出 ass/json（见模块头注释与主线程记录）。
 */
export async function fetchDanmakuXml(ctx: ParseContext, cid: number): Promise<string> {
  const xml = await ctx.http.getText(`https://comment.bilibili.com/${cid}.xml`);
  return xml;
}

/**
 * 拉取 web 播放器信息（字幕列表 + 分段章节，共用一次请求）。
 * 语义对齐桌面 player.py PlayerInfoParser.get_data：x/player/wbi/v2 + WBI 签名。
 */
export async function fetchPlayerInfo(
  ctx: ParseContext,
  item: { bvid?: string; aid?: number; cid: number },
): Promise<PlayerInfo> {
  const params: Record<string, string | number> = {
    cid: item.cid,
    dm_img_list: "[]",
    dm_img_str: DM_IMG_STR,
    dm_cover_img_str: DM_COVER_IMG_STR,
    dm_img_inter: DM_IMG_INTER,
  };
  if (item.bvid) {
    params["bvid"] = item.bvid;
  } else if (item.aid) {
    params["aid"] = item.aid;
  } else {
    throw new BiliError("INVALID_URL", "缺少 bvid/aid，无法获取播放器信息");
  }

  const { imgKey, subKey } = await ensureWbiKeys(ctx);
  const signed = wbiSign(params, imgKey, subKey);
  const body = await ctx.http.getJSON<DanmakuResponse>(
    "https://api.bilibili.com/x/player/wbi/v2",
    { params: signed },
  );
  assertOk(body, "获取播放器信息失败");
  if (!body.data) {
    throw new BiliError("API_ERROR", "播放器信息接口缺少 data");
  }
  return body.data;
}

/** 拼接字幕 JSON 地址（对齐上游 `f"https:{entry.subtitle_url}"`） */
export function resolveSubtitleUrl(url: string): string {
  if (url.startsWith("//")) return `https:${url}`;
  if (!/^https?:\/\//i.test(url)) return `https:${url}`;
  return url;
}

/**
 * 下载单条字幕 JSON 正文。
 * @param subtitle 播放器信息中的字幕条目，或直接传 subtitle_url 文本
 */
export async function fetchSubtitleJson(
  ctx: ParseContext,
  subtitle: SubtitleInfo | string,
): Promise<SubtitleJson> {
  const url = typeof subtitle === "string" ? subtitle : (subtitle.subtitleUrl ?? "");
  if (!url) {
    throw new BiliError("INVALID_URL", "字幕条目缺少 subtitle_url");
  }
  const body = await ctx.http.getJSON<SubtitleJson>(resolveSubtitleUrl(url));
  return body;
}

/** 一条已下载的字幕数据（对齐桌面 subtitles.py 组装结果） */
export interface SubtitleDataEntry {
  /** 语言码（lan） */
  language: string;
  /** 可读语言名（lan_doc，缺省回落语言码） */
  languageDoc: string;
  /** 字幕 JSON 正文 */
  data: SubtitleJson;
}

/**
 * 按语言配置过滤字幕列表（对齐桌面 SubtitlesParser._get_subtitles_data_list 的过滤分支）：
 * download_specified=true 时只保留 specified_languages 中的条目。
 */
export function filterSubtitleInfos(
  subtitles: SubtitleInfo[],
  selection: SubtitleLanguageSelection,
): SubtitleInfo[] {
  if (!selection.downloadSpecified) return subtitles;
  const wanted = new Set(selection.specifiedLanguages);
  return subtitles.filter((entry) => wanted.has(entry.lan));
}

/**
 * 下载所选语言的字幕正文（对齐桌面 subtitles.py：逐条拉取并按语言过滤后组装）。
 * 单条下载失败（如 AI 字幕尚未生成）时跳过该语言。
 */
export async function fetchSubtitlesData(
  ctx: ParseContext,
  subtitles: SubtitleInfo[],
  selection: SubtitleLanguageSelection,
): Promise<SubtitleDataEntry[]> {
  const result: SubtitleDataEntry[] = [];
  for (const entry of filterSubtitleInfos(subtitles, selection)) {
    try {
      const data = await fetchSubtitleJson(ctx, entry);
      if (data && typeof data === "object") {
        result.push({
          language: entry.lan,
          languageDoc: entry.lanDoc && entry.lanDoc.length > 0 ? entry.lanDoc : entry.lan,
          data,
        });
      }
    } catch {
      // 单条字幕拉取失败不阻断其余语言（与桌面 data 为空时跳过一致）
    }
  }
  return result;
}

/** 封面下载地址：图床 @.{format} 转码后缀（对齐桌面 cover.py） */
export function coverDownloadUrl(coverUrl: string, format: CoverFormat): string {
  return `${coverUrl}@.${format}`;
}

/**
 * 下载封面字节（按 @.{format} 由 B 站图床转码）。
 * 与桌面一致最多重试 3 次（HTTP 错误整体重试），仍失败抛错。
 */
export async function fetchCoverBytes(
  ctx: ParseContext,
  coverUrl: string,
  format: CoverFormat,
): Promise<Uint8Array> {
  const url = coverDownloadUrl(coverUrl, format);
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await ctx.http.getBuffer(url);
    } catch (err) {
      lastError = err;
    }
  }
  throw new BiliError("DOWNLOAD_FAILED", `封面下载失败：${url}`, { cause: lastError });
}

/** view/detail/tag 接口响应（tag 列表） */
interface VideoTagsResponse {
  code: number;
  message?: string;
  data?: Array<{ tag_name?: string; [key: string]: unknown }>;
}

/**
 * 拉取投稿视频 tag（视频 NFO 的 genre 来源）。
 * 语义对齐桌面 metadata.py _get_video_tags：x/web-interface/view/detail/tag?bvid=。
 * 接口失败/无数据时返回空列表（NFO 缺 tag 仍可生成）。
 */
export async function fetchVideoTags(ctx: ParseContext, bvid: string): Promise<string[]> {
  const body = await ctx.http.getJSON<VideoTagsResponse>(
    "https://api.bilibili.com/x/web-interface/view/detail/tag",
    { params: { bvid } },
  );
  if (body.code !== 0 || !body.data) return [];
  return body.data.map((tag) => tag.tag_name ?? "").filter((name) => name.length > 0);
}
