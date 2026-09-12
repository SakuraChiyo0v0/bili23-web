import {
  buildNamingVariables,
  formatFileName,
  validateRule,
  variablesFor,
  type ConventionTypeId,
  type MediaItem,
} from "@bili23-web/engine";

/**
 * 命名规则「预览」（原版 `EditRuleDialog.on_preview` / `edit_rule.py:197-254`）的 dry-run。
 *
 * 原版用**当前正在解析的那个稿件**当数据源（`FileNameFormatter` 持有 episode 数据）；
 * 设置页里没有解析上下文，所以这里按对账给出的改法用**固定示例数据**渲染，
 * 并在结果里标出来（前端会显示「以下为示例数据」），避免用户误以为是自己视频的真实路径。
 *
 * 校验顺序与文案逐条对齐原版 `get_format_result`：
 *   ① 空 → 命名规则不能为空
 *   ② 以 / 或 . 开头/结尾 → 命名规则不能以 '/' 或 '.' 开头或结尾
 *   ③ 字面量含非法字符 → 命名规则包含非法字符：<>:"|?* 或控制字符
 *   ④ 变量未知/括号不配平 → 命名规则无效
 *   ⑤ 渲染结果为空 → 命名规则无效
 *   ⑥ 渲染结果里出现非法字符 → 同上「非法字符」文案
 */

/** 非法字符（与原版 `[<>:\\"|?*\x00-\x1f]` 同一集合） */
const ILLEGAL_CHARS = /[<>:\\"|?*\u0000-\u001f]/;

/**
 * 预览用的示例稿件（值都写成一眼能认出来的"示例"）。
 *
 * 各类标识都给上：不同命名分类的可用变量不同（番剧用 ep_id/season_id、商城课用
 * course_id/lesson_id/item_id…），缺了就会渲染成空串、被误判成"规则无效"。
 */
export const DEMO_ITEM: MediaItem = {
  id: "video:BV1xx411c7mD:p1",
  type: "video",
  aid: 170001,
  bvid: "BV1xx411c7mD",
  cid: 280001,
  epId: 158662,
  seasonId: 4016,
  courseId: 1000625147,
  lessonId: 180281190609920,
  itemId: 10302975,
  sectionId: 1,
  auId: 123456,
  sid: 654321,
  page: 1,
  title: "示例视频标题",
  groupTitle: "示例视频标题",
  duration: 100,
  badge: "",
  cover: "",
  pubtime: 1600000000,
  owner: { mid: 1, name: "示例UP主", face: "" },
  desc: "",
  url: "https://www.bilibili.com/video/BV1xx411c7mD",
  partCount: 1,
  seasonTitle: "示例季标题",
  episodeTitle: "示例剧集标题",
  seriesTitle: "示例课程标题",
  seasonNumber: 1,
  episodeNumber: 1,
};

export interface NamingPreviewResult {
  ok: boolean;
  /** 相对目录（原版 `result.parent`），根目录时为空串 */
  folder?: string;
  /** 文件名（不含扩展名；原版 `result.stem`） */
  fileName?: string;
  /** 校验失败时的提示（简中，逐字取原版） */
  message?: string;
}

/**
 * 用示例数据试渲染一条命名规则。
 * @param rule 模板
 * @param type 命名分类（决定可用变量集合，默认 11 = 普通视频）
 */
export function previewNamingRule(rule: string, type: ConventionTypeId = 11): NamingPreviewResult {
  const raw = rule.trim();
  if (!raw) return { ok: false, message: "命名规则不能为空" };
  if (raw.startsWith("/") || raw.startsWith(".") || raw.endsWith("/") || raw.endsWith(".")) {
    return { ok: false, message: "命名规则不能以 '/' 或 '.' 开头或结尾" };
  }
  // 字面量里的非法字符：模板片段（{...} 之外）先查一遍，与原版的 Formatter.parse 遍历等价
  const literals = raw.replace(/\{[^}]*\}/g, "");
  if (ILLEGAL_CHARS.test(literals)) {
    return { ok: false, message: '命名规则包含非法字符：<>:"|?* 或控制字符' };
  }

  const known = new Set(variablesFor(type).map((v) => v.name));
  const errors = validateRule(raw, known);
  if (errors.length > 0) {
    return { ok: false, message: `命名规则无效：${errors.join("；")}` };
  }

  let rendered: string;
  try {
    rendered = formatFileName(raw, buildNamingVariables(DEMO_ITEM, { videoQuality: "1080P", audioQuality: "192K", videoCodec: "AVC" }, "1", 1600000000));
  } catch (e) {
    return { ok: false, message: `命名规则无效：${e instanceof Error ? e.message : String(e)}` };
  }
  if (!rendered || rendered === "_") return { ok: false, message: "命名规则无效" };
  // 渲染后还剩大括号 = 有 {…} 没被识别成变量（引擎的 TOKEN 只认标识符名，
  // 例如 {不存在的变量} 会原样留下）。原版走 `str.format()` 会抛 KeyError → 同样判「命名规则无效」
  if (/[{}]/.test(rendered)) {
    return { ok: false, message: "命名规则无效：存在无法识别的变量写法" };
  }

  const parts = rendered.split(/[/\\]+/).filter((p) => p.length > 0);
  if (parts.some((p) => ILLEGAL_CHARS.test(p))) {
    return { ok: false, message: '命名规则包含非法字符：<>:"|?* 或控制字符' };
  }
  const fileName = parts.length > 0 ? parts[parts.length - 1]! : "";
  const folder = parts.slice(0, -1).join("/");
  if (!fileName) return { ok: false, message: "命名规则无效" };
  return { ok: true, folder, fileName };
}
