import { ZH_TO_EN, ZH_TO_TW } from "./i18nDict.js";

/**
 * i18n 内核 —— **纯逻辑、不碰 DOM**（`apps/web/tests/` 同时受服务端 tsconfig 编译，
 * 那边没有 DOM lib，所以这里不能出现 document/window）。
 *
 * 设计取向（还没接进界面，见下）：
 * - **键就是简中文案**（`t("下载选项")`）。整个界面的文案本来就是从原版简中逐字抄的，
 *   拿它当键，字典可以由 `apps/web/scripts/gen-i18n.mjs` 从原版 Qt 翻译文件直接生成，
 *   一条都不用自己翻。
 * - **查不到就原样返回简中** —— 缺翻译时最差是"这一句还是中文"，永远不会出现空字符串或 key。
 * - 语言放模块级状态 + `App` 以语言为 key 重挂，省掉在 48 个文件里逐处订阅 store。
 */
export type Lang = "zh-CN" | "zh-TW" | "en";

export const LANGS: readonly Lang[] = ["zh-CN", "zh-TW", "en"] as const;
export const LANG_LABEL: Record<Lang, string> = { "zh-CN": "简体中文", "zh-TW": "繁體中文", en: "English" };

/**
 * 配置里的 `behavior.language`（含 `system`）→ 实际语言。
 * `system` 时按浏览器语言猜：`zh-TW`/`zh-HK`/`zh-Hant` → 繁中，其余中文 → 简中，非中文 → 英文。
 */
export function resolveLang(configLang: string | undefined, navLang?: string | undefined): Lang {
  if (configLang === "zh-CN" || configLang === "zh-TW" || configLang === "en") return configLang;
  const nav = (navLang ?? "").toLowerCase();
  if (!nav) return "zh-CN";
  if (nav.startsWith("zh")) {
    return /hant|tw|hk|mo/.test(nav) ? "zh-TW" : "zh-CN";
  }
  return "en";
}

let current: Lang = "zh-CN";

export function setCurrentLang(lang: Lang): void {
  current = lang;
}
export function getCurrentLang(): Lang {
  return current;
}

/** 指定语言翻译（纯函数，便于单测） */
export function tIn(zh: string, lang: Lang): string {
  if (lang === "zh-CN" || !zh) return zh;
  const table = lang === "en" ? ZH_TO_EN : ZH_TO_TW;
  const hit = table[zh];
  // 繁中缺条目时退回简中（原版 zh_TW 有过未翻译项）；英文同理
  return hit && hit.length > 0 ? hit : zh;
}

/** 用当前语言翻译 */
export function t(zh: string): string {
  return tIn(zh, current);
}

/** 这句在当前语言下是否真的有译文（覆盖率统计/自查用） */
export function isTranslated(zh: string, lang: Lang = current): boolean {
  return tIn(zh, lang) !== zh;
}

/**
 * **带占位符**的翻译：原版文案里带变量时写的是 `{selected_count}` / `{category_name}` 这种，
 * 我们代码里是 `${}` 模板串。把"带占位符的简中原文"当键来查，再回填参数：
 *
 * ```ts
 * trp("{category_name}（已选择 {selected_count} 项，共 {total_count} 项）", { category_name, selected_count, total_count })
 * ```
 * 这样切语言时占位符顺序/数量不同也不怕（各语言的词序不一样，不能靠拼字符串）。
 * 查不到译文就返回**用简中原样回填**的结果（不会出现空串或 key）。
 */
export function tInWith(
  zh: string,
  values: Record<string, string | number>,
  lang: Lang = current,
): string {
  const pattern = tIn(zh, lang);
  return pattern.replace(/\{(\w+)\}/g, (all, name: string) =>
    name in values ? String(values[name]) : all,
  );
}

/** `tInWith` 的当前语言版本 */
export function trp(zh: string, values: Record<string, string | number>): string {
  return tInWith(zh, values, current);
}

/** 字典规模（两种非简中语言的条目数） */
export function dictSize(): { en: number; tw: number } {
  return { en: Object.keys(ZH_TO_EN).length, tw: Object.keys(ZH_TO_TW).length };
}
