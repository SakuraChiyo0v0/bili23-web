/**
 * 把底层报错**改写成人能看懂的长提示** —— 对齐原版的那几句（简中译文逐字取自 `zh_CN.ts`）。
 *
 * 为什么用"改写文案"而不是"提前检查"：上一轮我试过在任务运行器里插一步目录校验，
 * 结果**动到了调度时序**（顶掉了一条队列用例），已回退（见归档）。
 * 改写文案零时序风险，而且覆盖面更广 —— 目录被删、挂载掉了、权限变了、ffmpeg 没装，
 * 最终都会以这些底层错误的形式冒出来。
 */

/** 当前下载目录不可用（原版 `MainWindowBase` 运行时提示） */
export const DIR_INVALID_TEXT = "当前下载目录无法访问或没有写入权限，请重新设置。";
/** 找不到 FFmpeg（原版 `SettingInterface` 的说法，改成 Web 端可执行的建议） */
export const FFMPEG_MISSING_TEXT =
  "未找到 FFmpeg 可执行文件，无法合并或转换。请安装 FFmpeg 并确保在 PATH 中，或在「高级 → FFmpeg 设置」里指定路径。";

/** 写盘类系统错误码：目录不可写/不存在/只读 */
const DIR_ERRNOS = ["EACCES", "EPERM", "EROFS", "ENOENT", "ENOTDIR", "ENOSPC", "EBUSY"];
/** ffmpeg 缺失的典型字样 */
const FFMPEG_HINTS = ["ffmpeg", "ffprobe"];

/**
 * 判断一个错误是否与"下载目录不可用"有关。
 * 只看 `errno` 不够：`ENOENT` 也可能是"分片临时文件没找到"，所以**必须同时**带路径/写盘字样。
 */
function looksLikeDirError(text: string): boolean {
  const hasErrno = DIR_ERRNOS.some((e) => text.includes(e));
  if (!hasErrno) return false;
  return /(mkdir|open|write|create|access|rename|directory|目录)/i.test(text);
}

/** ffmpeg 未找到：报错里出现 ffmpeg/ffprobe，且是"找不到/不是可执行"这类 */
function looksLikeFfmpegMissing(text: string): boolean {
  const lower = text.toLowerCase();
  if (!FFMPEG_HINTS.some((h) => lower.includes(h))) return false;
  return /(enoent|not found|找不到|no such file|spawn|eacces)/i.test(lower);
}

/**
 * 改写错误文案；不认识的原样返回（**绝不吞掉原始信息**）。
 * 原始报错仍会进任务日志与系统日志，这里只决定"卡片上给用户看什么"。
 */
export function friendlyDownloadError(raw: string): string {
  if (looksLikeFfmpegMissing(raw)) return `${FFMPEG_MISSING_TEXT}（原始错误：${raw}）`;
  if (looksLikeDirError(raw)) return `${DIR_INVALID_TEXT}（原始错误：${raw}）`;
  return raw;
}
