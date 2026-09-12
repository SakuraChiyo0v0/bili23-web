import { describe, expect, it } from "vitest";
import { LANGS, LANG_LABEL, dictSize, getCurrentLang, isTranslated, resolveLang, setCurrentLang, t, tIn, tInWith } from "../src/client/lib/i18n.js";

describe("i18n 内核（键=简中文案，字典由原版 Qt 翻译文件生成）", () => {
  it("resolveLang：显式语言原样返回，system 按浏览器语言猜", () => {
    expect(resolveLang("zh-CN")).toBe("zh-CN");
    expect(resolveLang("zh-TW")).toBe("zh-TW");
    expect(resolveLang("en")).toBe("en");
    // system / 未配置
    expect(resolveLang("system", "zh-CN")).toBe("zh-CN");
    expect(resolveLang("system", "zh-TW")).toBe("zh-TW");
    expect(resolveLang("system", "zh-HK")).toBe("zh-TW");
    expect(resolveLang("system", "zh-Hant-TW")).toBe("zh-TW");
    expect(resolveLang("system", "en-US")).toBe("en");
    expect(resolveLang("system", "ja-JP")).toBe("en");
    expect(resolveLang(undefined, undefined)).toBe("zh-CN");
    expect(resolveLang("system", "")).toBe("zh-CN");
  });

  it("简中恒等：不做任何替换", () => {
    expect(tIn("下载选项", "zh-CN")).toBe("下载选项");
    expect(tIn("这句话没有译文", "zh-CN")).toBe("这句话没有译文");
  });

  it("英文/繁中：命中原版译文（词典来自原版 Qt 的 <source> / zh_TW <translation>）", () => {
    expect(tIn("下载选项", "en")).toBe("Download Options");
    expect(tIn("批量选择", "en")).toBe("Batch Select");
    expect(tIn("下载选项", "zh-TW")).toBe("下載選項");
    // 「批量选择」在简中里对应两条英文（Batch Select / Batch Selection），
    // 生成脚本按"英文更短"取胜 → 拿到的是 Batch Select 那条的繁中译法
    expect(tIn("批量选择", "zh-TW")).toBe("批次選取");
    expect(tIn("检测到下载列表中已存在相同的下载任务，是否继续下载？", "en")).toContain("duplicate download task");
  });

  it("查不到就原样返回简中（缺翻译时不会出现空串或 key）", () => {
    expect(tIn("这是我们自己加的一句提示", "en")).toBe("这是我们自己加的一句提示");
    expect(tIn("这是我们自己加的一句提示", "zh-TW")).toBe("这是我们自己加的一句提示");
    expect(tIn("", "en")).toBe("");
  });

  it("trp：带占位符的文案（原版用 {name}，我们用 ${}）", () => {
    // 原版 CATEGORY/COUNT 那两句就是带占位符的，字典里存的也是带占位符的简中
    const zh = "{category_name}（已选择 {selected_count} 项，共 {total_count} 项）";
    expect(tInWith(zh, { category_name: "收藏夹", selected_count: 3, total_count: 9 }, "zh-CN"))
      .toBe("收藏夹（已选择 3 项，共 9 项）");
    const en = tInWith(zh, { category_name: "Favorites", selected_count: 3, total_count: 9 }, "en");
    // 有译文时必须真的用上译文（各语言词序不同，不能靠拼串）
    expect(en).toContain("Favorites");
    expect(en).not.toContain("{");
  });

  it("trp：没有译文的句子按简中原样回填（不出现 key 或空串）", () => {
    expect(tInWith("我们自己加的一句 {n} 条", { n: 5 }, "en")).toBe("我们自己加的一句 5 条");
    // 占位符在 values 里没有 → 原样保留，不静默变成 undefined
    expect(tInWith("缺参数的 {missing} 占位", {}, "en")).toBe("缺参数的 {missing} 占位");
  });

  it("模块级当前语言 + t() 用当前语言", () => {
    expect(getCurrentLang()).toBe("zh-CN");
    expect(t("下载选项")).toBe("下载选项");
    setCurrentLang("en");
    expect(getCurrentLang()).toBe("en");
    expect(t("下载选项")).toBe("Download Options");
    expect(isTranslated("下载选项")).toBe(true);
    expect(isTranslated("我们自己的提示")).toBe(false);
    setCurrentLang("zh-CN");
    expect(t("下载选项")).toBe("下载选项");
  });

  it("字典规模与语言清单自洽（904 条里去掉弃用与撞车后应有数百条）", () => {
    const { en, tw } = dictSize();
    expect(en).toBeGreaterThan(700);
    expect(tw).toBe(en);
    expect([...LANGS]).toEqual(["zh-CN", "zh-TW", "en"]);
    expect(LANG_LABEL["zh-TW"]).toBe("繁體中文");
  });
});
