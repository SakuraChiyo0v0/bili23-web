import type { DanmakuEntry, DanmakuStyle } from "./types.js";
import { DEFAULT_DANMAKU_STYLE } from "./types.js";
import { formatAssTimeByMs } from "./time.js";
import { renderAss } from "./ass-base.js";

/**
 * 弹幕 → ASS（对齐桌面 file/danmaku_ass.py）。
 * 逐字保留：ass_base 模板、样式行格式、弹幕时长映射（滚动 10s/顶部底部 5s）、
 * \move/\an8/\an2 定位、颜色 BGR 转换、满屏丢弃策略。
 *
 * 简化（与上游语义差异见主线程记录）：上游用 Qt QFontMetrics 实测文本宽度/行高，
 * 本引擎为零依赖纯函数用确定性估算（全角≈字号、半角≈字号/2、行高≈字号*1.2+4），
 * 因此行分配/坐标与桌面不完全逐像素一致，但结构同构。
 */

/** 估算单行文本像素宽度（替代 QFontMetrics.horizontalAdvance） */
export function measureTextWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const ch of Array.from(text)) {
    const cp = ch.codePointAt(0) ?? 0;
    // 中文/日文假名/全角符号等 ≥0x2E80 按全角（1 字号），其余按半角（0.5 字号）
    width += cp >= 0x2e80 ? fontSize : fontSize * 0.5;
  }
  return Math.round(width);
}

/** Python float 文本化：整数值补 .0（对齐 Python str(1.0) 输出 "1.0"） */
export function pyFloat(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : String(value);
}

/** 估算单行文本高度（替代 QFontMetrics.height() + 4） */
export function estimateLineHeight(fontSize: number): number {
  return Math.round(fontSize * 1.2) + 4;
}

/** 滚动轨道：记录上一条弹幕，判断新弹幕是否可安全放入 */
class ScrollTrack {
  readonly #screenWidth: number;
  readonly #minGap: number;
  #lastStime = -1;
  #lastDuration = 0;
  #lastWidth = 0;
  #lastSpeed = 0.0;

  constructor(screenWidth: number, minGap: number) {
    this.#screenWidth = screenWidth;
    this.#minGap = minGap;
  }

  canFit(stime: number, speed: number): boolean {
    if (this.#lastStime === -1) return true;
    // 条件1：前一条尾部离开右边缘并保持最小间距
    const cond1 = stime >= this.#lastStime + (this.#lastWidth + this.#minGap) / this.#lastSpeed;
    // 条件2：前一条到达左边缘时当前条头部未到左边缘（保持最小间距）
    const cond2 =
      stime >= this.#lastStime + this.#lastDuration - (this.#screenWidth - this.#minGap) / speed;
    return cond1 && cond2;
  }

  push(stime: number, durationMs: number, textWidth: number, speed: number): void {
    this.#lastStime = stime;
    this.#lastDuration = durationMs;
    this.#lastWidth = textWidth;
    this.#lastSpeed = speed;
  }
}

/** 静态轨道（顶部/底部固定弹幕） */
class StaticTrack {
  #endTime = -1;
  canFit(stime: number): boolean {
    return stime >= this.#endTime;
  }
  push(endTime: number): void {
    this.#endTime = endTime;
  }
}

interface LayoutInput {
  width: number;
  height: number;
  style: DanmakuStyle;
}

class LayoutEngine {
  readonly #style: DanmakuStyle;
  readonly #lineHeight: number;
  readonly #fontSize: number;
  readonly #scrollTracks: ScrollTrack[];
  readonly #topTracks: StaticTrack[];
  readonly #bottomTracks: StaticTrack[];

  constructor(input: LayoutInput) {
    this.#style = input.style;
    this.#fontSize = input.style.font.size;
    this.#lineHeight = estimateLineHeight(this.#fontSize);
    const scrollRows = Math.max(1, Math.floor((input.height * (input.style.advanced.displayArea / 100.0)) / this.#lineHeight));
    this.#scrollTracks = Array.from(
      { length: scrollRows },
      () => new ScrollTrack(input.width, input.style.advanced.minimumGap),
    );
    this.#topTracks = Array.from({ length: scrollRows }, () => new StaticTrack());
    this.#bottomTracks = Array.from({ length: scrollRows }, () => new StaticTrack());
  }

  allocScroll(stime: number, textWidth: number, durationMs: number): number | null {
    const speed = (this.#style.resolution.width + textWidth) / durationMs;
    for (let row = 0; row < this.#scrollTracks.length; row += 1) {
      const track = this.#scrollTracks[row];
      if (track !== undefined && track.canFit(stime, speed)) {
        track.push(stime, durationMs, textWidth, speed);
        return row;
      }
    }
    return null;
  }

  allocTop(stime: number, durationMs: number): number | null {
    for (let row = 0; row < this.#topTracks.length; row += 1) {
      const track = this.#topTracks[row];
      if (track !== undefined && track.canFit(stime)) {
        track.push(stime + durationMs);
        return row;
      }
    }
    return null;
  }

  allocBottom(stime: number, durationMs: number): number | null {
    for (let row = 0; row < this.#bottomTracks.length; row += 1) {
      const track = this.#bottomTracks[row];
      if (track !== undefined && track.canFit(stime)) {
        track.push(stime + durationMs);
        return row;
      }
    }
    return null;
  }

  get lineHeight(): number {
    return this.#lineHeight;
  }
}

/** 生成样式行（对齐上游 _get_style_info：透明度换算 alpha、颜色 &HalphaFFFFFF 系） */
export function buildDanmakuStyleLine(style: DanmakuStyle): string {
  const opacity = style.advanced.opacity / 100.0;
  const alpha = Math.floor((1.0 - opacity) * 255);
  const alphaHex = alpha.toString(16).padStart(2, "0").toUpperCase();

  const b = (v: boolean): number => (v ? 1 : 0);
  return (
    `Style: Default,${style.font.name},${style.font.size},&H${alphaHex}FFFFFF,&H${alphaHex}0000FF,` +
    `&H${alphaHex}000000,&H${alphaHex}000000,${b(style.font.bold)},${b(style.font.italic)},` +
    `${b(style.font.underline)},${b(style.font.strike)},100,100,0,0,1,${pyFloat(style.border.border)},` +
    `${style.border.shadow},7,0,0,0,1`
  );
}

/** 把颜色值转成 ASS BGR 色号（对齐上游 `\c&H{bgr:06X}&`） */
function toBgrColorTag(color: number): string {
  const c = Math.trunc(color);
  const bgr = ((c & 0xff) << 16) | (c & 0xff00) | ((c >> 16) & 0xff);
  return `\\c&H${bgr.toString(16).padStart(6, "0").toUpperCase()}&`;
}

/**
 * 弹幕条目 → ASS 文本。
 * @param entries 按出现时间排序前的原始条目（内部会按 stime 排序，与上游一致）
 * @param title ASS 标题（通常为视频主标题）
 * @param style 弹幕样式（默认 DEFAULT_DANMAKU_STYLE）
 */
export function danmakuToAss(
  entries: DanmakuEntry[],
  title: string,
  style: DanmakuStyle = DEFAULT_DANMAKU_STYLE,
): string {
  const sorted = [...entries].sort((a, b) => a.stime - b.stime);
  const width = style.resolution.width;
  const height = style.resolution.height;

  const scrollDurationMs = style.advanced.scrollDuration * 1000;
  const staticDurationMs = style.advanced.staticDuration * 1000;

  const engine = new LayoutEngine({ width, height, style });
  const dialogues: string[] = [];

  for (const entry of sorted) {
    const mode = entry.mode;
    const stime = entry.stime;
    const text = entry.text ?? "";
    if (!text || !(mode === 1 || mode === 2 || mode === 3 || mode === 4 || mode === 5)) continue;

    const durationMs = mode === 4 || mode === 5 ? staticDurationMs : scrollDurationMs;
    const textWidth = measureTextWidth(text, style.font.size);

    const startAss = formatAssTimeByMs(stime);
    const endAss = formatAssTimeByMs(stime + durationMs);

    let styleLabel = "";
    let row: number | null = null;

    if (mode === 1 || mode === 2 || mode === 3) {
      row = engine.allocScroll(stime, textWidth, durationMs);
      if (row !== null) {
        const y = row * engine.lineHeight;
        styleLabel = `\\move(${width},${y},-${textWidth},${y})`;
      }
    } else if (mode === 5) {
      row = engine.allocTop(stime, durationMs);
      if (row !== null) {
        const y = row * engine.lineHeight;
        styleLabel = `\\an8\\pos(${Math.floor(width / 2)},${y})`;
      }
    } else if (mode === 4) {
      row = engine.allocBottom(stime, durationMs);
      if (row !== null) {
        const y = height - row * engine.lineHeight;
        styleLabel = `\\an2\\pos(${Math.floor(width / 2)},${y})`;
      }
    }

    if (row === null) continue; // 满屏丢弃，防重叠

    let colorTag = "";
    const color = entry.color;
    if (color !== undefined && color !== 16777215) {
      colorTag = toBgrColorTag(color);
    }

    dialogues.push(`Dialogue: 0,${startAss},${endAss},Default,,0,0,0,,{${styleLabel}${colorTag}}${text}`);
  }

  return renderAss({
    title,
    styleLine: buildDanmakuStyleLine(style),
    dialogues,
    width,
    height,
  });
}
