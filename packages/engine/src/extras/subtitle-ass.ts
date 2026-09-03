import type { SubtitleJson, SubtitleStyle } from "./types.js";
import { DEFAULT_SUBTITLE_STYLE } from "./types.js";
import { formatAssTimeBySeconds } from "./time.js";
import { renderAss } from "./ass-base.js";

/**
 * 字幕 JSON → ASS（对齐桌面 file/subtitle_ass.py）。
 * - 样式行、ass_base 模板与上游一致，样式默认值取自 DEFAULT_SUBTITLE_STYLE；
 * - 时间轴用 format_ass_time_by_seconds（秒输入）；
 * - 附带字幕轨内嵌所需语言归一化（ISO 639-2）与轨标题规则（AI 字幕加 "(AI Generated)"）。
 */

/** B 站 AI 生成字幕语言前缀（如 ai-zh、ai-es） */
export const AI_LANGUAGE_PREFIX = "ai-";

/**
 * B 站语言标签 → ISO 639-2 三字母码（MKV Language 元素用；对齐上游 LANGUAGE_CODE_MAP）。
 * 表中没有的按原样返回（不用 und 兜底，避免丢失已知语言信息）。
 */
export const LANGUAGE_CODE_MAP: Readonly<Record<string, string>> = {
  zh: "chi",
  "zh-cn": "chi",
  "zh-hans": "chi",
  "zh-hant": "chi",
  "zh-hk": "chi",
  "zh-tw": "chi",
  en: "eng",
  "en-us": "eng",
  "en-gb": "eng",
  ja: "jpn",
  jp: "jpn",
  ko: "kor",
  es: "spa",
  ar: "ara",
  pt: "por",
  fr: "fre",
  de: "ger",
  ru: "rus",
  it: "ita",
  vi: "vie",
  th: "tha",
  id: "ind",
  ms: "may",
  hi: "hin",
  tr: "tur",
  pl: "pol",
  nl: "dut",
  tl: "tgl",
};

/** 语言码 → ISO 639-2（AI 前缀先剥掉再查一次） */
export function toIso639_2(language: string): string {
  const key = language.toLowerCase();
  const direct = LANGUAGE_CODE_MAP[key];
  if (direct) return direct;
  if (key.startsWith(AI_LANGUAGE_PREFIX)) {
    const inner = LANGUAGE_CODE_MAP[key.slice(AI_LANGUAGE_PREFIX.length)];
    if (inner) return inner;
  }
  return language;
}

/**
 * 字幕轨标题：AI 字幕与人工字幕同名，需要标注来源避免播放器菜单出现两条"中文"。
 * 对齐 Translator.SUBTITLE_TRACK_TITLE("AI_GENERATED")："{name} (AI Generated)"。
 */
export function subtitleTrackTitle(lan: string, lanDoc?: string): string {
  const title = lanDoc && lanDoc.length > 0 ? lanDoc : lan;
  if (lan.toLowerCase().startsWith(AI_LANGUAGE_PREFIX)) {
    return `${title} (AI Generated)`;
  }
  return title;
}

/** Python float 文本化：整数值补 .0（对齐 Python str(1.0) 输出 "1.0"） */
function pyFloat(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : String(value);
}

/** 生成字幕 ASS 样式行（对齐上游 subtitle_ass.py _get_style_info） */
export function buildSubtitleStyleLine(style: SubtitleStyle): string {
  const b = (v: boolean): number => (v ? 1 : 0);
  return (
    `Style: Default,${style.font.name},${style.font.size},${style.color.primary},` +
    `${style.color.secondary},${style.color.border},${style.color.shadow},` +
    `${b(style.font.bold)},${b(style.font.italic)},${b(style.font.underline)},${b(style.font.strike)},` +
    `100,100,0,0,1,${pyFloat(style.border.border)},${pyFloat(style.border.shadow)},${style.alignment},` +
    `${style.margin.left},${style.margin.right},${style.margin.vertical},1`
  );
}

/**
 * 字幕 JSON → ASS 文本。
 * @param data 字幕 JSON（body 每项含 from/to/content，单位为秒）
 * @param title ASS 标题（通常为视频主标题）
 * @param style 字幕样式（默认 DEFAULT_SUBTITLE_STYLE）
 */
export function toSubtitleAss(
  data: SubtitleJson,
  title: string,
  style: SubtitleStyle = DEFAULT_SUBTITLE_STYLE,
): string {
  const dialogues: string[] = [];
  for (const item of data.body ?? []) {
    const start = formatAssTimeBySeconds(item.from ?? 0);
    const end = formatAssTimeBySeconds(item.to ?? 0);
    const content = item.content ?? "";
    dialogues.push(`Dialogue: 0,${start},${end},Default,,0,0,0,,${content}`);
  }
  return renderAss({
    title,
    styleLine: buildSubtitleStyleLine(style),
    dialogues,
    width: style.resolution.width,
    height: style.resolution.height,
  });
}
