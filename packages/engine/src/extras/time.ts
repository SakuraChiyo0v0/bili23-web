/**
 * 附加内容时间轴格式（语义对齐桌面 util/format/time.py）。
 * 所有函数都是纯函数：输入秒/毫秒，输出 SRT/ASS 时间轴文本。
 */

/** Python round（银行家舍入 half-to-even），对齐上游 round() 语义 */
export function pyRound(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  // 恰为 .5 时取偶数
  return floor % 2 === 0 ? floor : floor + 1;
}

/**
 * SRT 时间轴 `HH:MM:SS,mmm`（对齐 Time.format_srt_time）。
 * 输入为秒（可为小数）。
 */
export function formatSrtTime(seconds: number): string {
  let h = Math.floor(seconds / 3600);
  let m = Math.floor((seconds % 3600) / 60);
  let s = Math.floor(seconds % 60);
  let ms = pyRound((seconds - Math.floor(seconds)) * 1000);

  if (ms === 1000) {
    s += 1;
    ms = 0;
  }
  if (s >= 60) {
    m += Math.floor(s / 60);
    s %= 60;
  }
  if (m >= 60) {
    h += Math.floor(m / 60);
    m %= 60;
  }
  const pad = (n: number, w = 2): string => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

/**
 * ASS 时间轴 `H:MM:SS.cc`（对齐 Time.format_ass_time_by_ms）。
 * 输入为毫秒整数。
 */
export function formatAssTimeByMs(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  let centis = pyRound((ms % 1000) / 10.0);
  if (centis === 100) centis = 99;

  const pad = (n: number, w = 2): string => String(n).padStart(w, "0");
  return `${hours}:${pad(minutes)}:${pad(seconds)}.${pad(centis)}`;
}

/**
 * ASS 时间轴 `H:MM:SS.cc`（对齐 Time.format_ass_time_by_seconds）。
 * 输入为秒（可为小数）。
 */
export function formatAssTimeBySeconds(seconds: number): string {
  let h = Math.floor(seconds / 3600);
  let m = Math.floor((seconds % 3600) / 60);
  let s = Math.floor(seconds % 60);
  let cs = pyRound((seconds - Math.floor(seconds)) * 100);

  if (cs === 100) {
    s += 1;
    cs = 0;
  }
  if (s >= 60) {
    m += Math.floor(s / 60);
    s %= 60;
  }
  if (m >= 60) {
    h += Math.floor(m / 60);
    m %= 60;
  }
  const pad = (n: number, w = 2): string => String(n).padStart(w, "0");
  return `${h}:${pad(m)}:${pad(s)}.${pad(cs)}`;
}

/** Unix 秒 → 本地日期 `YYYY-MM-DD`（NFO premiered/year 用；对齐 datetime.fromtimestamp().strftime） */
export function formatDateYmd(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
