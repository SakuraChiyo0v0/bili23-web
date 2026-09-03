import type { MetadataInput, NfoOutput } from "./types.js";
import { EXTRA_QUALIFIER } from "./types.js";
import { formatDateYmd } from "./time.js";

/**
 * 元数据 NFO 生成（对齐桌面 file/metadata_nfo.py）。
 * - 投稿视频（kind=video）→ movie.nfo（附限定词 Metadata）；
 * - 番剧/课程/商城课（bangumi/cheese/lesson）→ tvshow.nfo + episodedetails.nfo（无限定词）；
 * - 模板与上游逐字一致：{tag}/{genre}/{country}/{rating}/{status} 为多行占位，占位所在行自带 4 空格
 *   缩进，占位值只负责"后续行"的缩进（与上游 .format 语义一致）；
 * - 最终按上游写法去除空行；缺省可选字段整块省略。
 */

const VIDEO_BASE = `<?xml version="1.0" encoding="UTF-8"?>
<movie>
    <title>{title}</title>
    <plot>{plot}</plot>
    <runtime>{runtime}</runtime>
    <premiered>{premiered}</premiered>
    <year>{year}</year>
    <actor>
        <name>{uploader}</name>
        <role>UP主</role>
        <profile>https://space.bilibili.com/{uploader_uid}</profile>
        <thumb>{uploader_face}</thumb>
    </actor>
    {tag}
    <thumb>{thumb}</thumb>
    <uniqueid type="bvid">{bvid}</uniqueid>
</movie>`;

const TVSHOW_BASE = `<?xml version="1.0" encoding="UTF-8"?>
<tvshow>
    <title>{title}</title>
    <plot>{plot}</plot>
    <premiered>{premiered}</premiered>
    <year>{year}</year>
    <studio>Bilibili</studio>
    <director>{director}</director>
    {genre}
    {country}
    {rating}
    {status}
    <thumb aspect="poster">{thumb}</thumb>
    <uniqueid type="season_id">{season_id}</uniqueid>
</tvshow>`;

const EPISODE_BASE = `<?xml version="1.0" encoding="UTF-8"?>
<episodedetails>
    <title>{title}</title>
    <plot>{plot}</plot>
    <runtime>{runtime}</runtime>
    <premiered>{premiered}</premiered>
    <year>{year}</year>
    <studio>Bilibili</studio>
    <episode>{episode}</episode>
    <director>{director}</director>
    {genre}
    {country}
    <thumb>{thumb}</thumb>
    <uniqueid type="ep_id">{ep_id}</uniqueid>
</episodedetails>`;

/**
 * 多行元素值（如 tag/genre/country）。
 * 第一行不加缩进（占位行自带的 4 空格就是它的缩进），后续行各带 4 空格，
 * 对齐上游 `"\n    ".join([f"<tag>.."]...)`。
 */
function elementLines(values: string[], element: string): string {
  if (values.length === 0) return "";
  return values.map((v) => `<${element}>${v}</${element}>`).join("\n    ");
}

/** 评分块：首行前带一个空行，占位行替换后经空行清理得到 4 空格起步的块 */
function ratingBlock(rating: number, votes: number): string {
  return [
    "",
    "    <ratings>",
    '        <rating default="true" max="10" name="Bilibili">',
    `            <value>${rating}</value>`,
    `            <votes>${votes}</votes>`,
    "        </rating>",
    "    </ratings>",
    `    <rating>${rating}</rating>`,
  ].join("\n");
}

/** 去除生成内容中的空行/纯空白行（对齐上游 _to_nfo 写盘前的清理） */
function stripBlankLines(contents: string): string {
  return contents
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .join("\n");
}

function fill(template: string, values: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(values)) {
    out = out.split(`{${key}}`).join(value);
  }
  return out;
}

function yearOf(timestamp: number): string {
  return String(new Date(timestamp * 1000).getFullYear());
}

function generateVideo(input: MetadataInput): string {
  const rendered = fill(VIDEO_BASE, {
    title: input.showTitle,
    plot: input.description,
    runtime: String(Math.ceil(input.durationSec / 60)),
    premiered: formatDateYmd(input.pubtime),
    year: yearOf(input.pubtime),
    uploader: input.owner.name,
    uploader_uid: String(input.owner.mid),
    uploader_face: input.owner.face,
    tag: elementLines(input.tags ?? [], "tag"),
    thumb: input.cover,
    bvid: input.bvid ?? "",
  });
  return stripBlankLines(rendered);
}

function generateTvshow(input: MetadataInput): string {
  const premieredTs = input.premiered ?? input.pubtime;
  const rendered = fill(TVSHOW_BASE, {
    title: input.seasonTitle ?? input.showTitle,
    plot: input.description,
    premiered: formatDateYmd(premieredTs),
    year: yearOf(premieredTs),
    director: input.owner.name,
    genre: elementLines(input.genres ?? [], "genre"),
    country: elementLines(input.areas ?? [], "country"),
    rating:
      input.rating !== undefined && input.rating > 0
        ? ratingBlock(input.rating, input.ratingVotes ?? 0)
        : "",
    status: input.newEpStatus === true ? "<status>Ongoing</status>" : "<status>Ended</status>",
    thumb: input.poster ?? input.cover,
    season_id: String(input.seasonId ?? ""),
  });
  return stripBlankLines(rendered);
}

function generateEpisode(input: MetadataInput): string {
  const rendered = fill(EPISODE_BASE, {
    title: input.episodeTitle ?? input.showTitle,
    plot: input.description,
    runtime: String(Math.ceil(input.durationSec / 60)),
    premiered: formatDateYmd(input.pubtime),
    year: yearOf(input.pubtime),
    episode: String(input.episodeNumber ?? ""),
    director: input.owner.name,
    genre: elementLines(input.genres ?? [], "genre"),
    country: elementLines(input.areas ?? [], "country"),
    thumb: input.cover,
    ep_id: String(input.epId ?? ""),
  });
  return stripBlankLines(rendered);
}

/**
 * 生成 NFO 输出列表。
 * @param input 结构化元数据（由上层从 MediaItem/季剧信息组装）
 * @param stem 主文件名 stem（movie.nfo 与 episodedetails.nfo 的基础名）
 * @param includeTvshow 是否包含 tvshow.nfo（同季多集由调用方在已存在时传 false，对齐上游 _is_tvshow_exists）
 */
export function buildMetadataNfo(
  input: MetadataInput,
  stem: string,
  includeTvshow = true,
): NfoOutput[] {
  if (input.kind === "video") {
    return [{ contents: generateVideo(input), name: stem, qualifier: [EXTRA_QUALIFIER.metadata] }];
  }
  const outputs: NfoOutput[] = [];
  if (includeTvshow) {
    outputs.push({ contents: generateTvshow(input), name: "tvshow", qualifier: [] });
  }
  outputs.push({ contents: generateEpisode(input), name: stem, qualifier: [] });
  return outputs;
}
