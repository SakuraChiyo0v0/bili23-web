import { describe, expect, it } from "vitest";
import { DEMO_ITEM, previewNamingRule } from "../src/server/naming-preview.js";

describe("命名规则预览（原版 EditRuleDialog.on_preview 的 dry-run）", () => {
  it("普通规则渲染出子目录与文件名", () => {
    const r = previewNamingRule("{uploader}/{leaf_title}");
    expect(r.ok).toBe(true);
    expect(r.folder).toBe("示例UP主");
    expect(r.fileName).toBe("示例视频标题");
  });

  it("没有子目录时 folder 为空串", () => {
    const r = previewNamingRule("{leaf_title}");
    expect(r.ok).toBe(true);
    expect(r.folder).toBe("");
    expect(r.fileName).toBe("示例视频标题");
  });

  it("示例数据本身是自解释的（避免用户误当真实路径）", () => {
    expect(DEMO_ITEM.title).toContain("示例");
    expect(DEMO_ITEM.owner.name).toContain("示例");
  });

  it("空规则：命名规则不能为空", () => {
    expect(previewNamingRule("   ")).toEqual({ ok: false, message: "命名规则不能为空" });
  });

  it("以 / 或 . 开头结尾：逐字取原版文案", () => {
    const msg = "命名规则不能以 '/' 或 '.' 开头或结尾";
    expect(previewNamingRule("/{leaf_title}")).toEqual({ ok: false, message: msg });
    expect(previewNamingRule("{leaf_title}/")).toEqual({ ok: false, message: msg });
    expect(previewNamingRule(".{leaf_title}")).toEqual({ ok: false, message: msg });
    expect(previewNamingRule("{leaf_title}.")).toEqual({ ok: false, message: msg });
  });

  it("字面量里的非法字符被拒", () => {
    expect(previewNamingRule("{leaf_title}?x").message).toBe('命名规则包含非法字符：<>:"|?* 或控制字符');
  });

  it("未知变量：命名规则无效", () => {
    // 英文标识符名：引擎的 TOKEN 认得，validateRule 会点名
    const r = previewNamingRule("{no_such_var}");
    expect(r.ok).toBe(false);
    expect(r.message).toContain("命名规则无效");
    expect(r.message).toContain("no_such_var");
    // 非标识符名（中文）：TOKEN 认不出，会原样留到渲染结果里 —— 同样必须判无效，
    // 不能把 "{不存在的变量}" 当成合法文件名吐出来（原版 str.format 会 KeyError）
    const r2 = previewNamingRule("{不存在的变量}");
    expect(r2.ok).toBe(false);
    expect(r2.message).toContain("命名规则无效");
  });

  it("变量集合按命名分类分派：课程变量在普通视频分类里不可用", () => {
    expect(previewNamingRule("{leaf_title}", 11).ok).toBe(true);
    // course_id 只在商城课（31）里可用；番剧/课程（30 = CHEESE）没有它
    expect(previewNamingRule("{course_id}", 11).ok).toBe(false);
    expect(previewNamingRule("{course_id}", 30).ok).toBe(false);
    expect(previewNamingRule("{course_id}", 31).ok).toBe(true);
  });

  it("各类标识都给了示例值：番剧/课程规则也能渲染出东西", () => {
    const bangumi = previewNamingRule("{season_title}/{episode_title}", 20);
    expect(bangumi.ok).toBe(true);
    expect(bangumi.folder).toBe("示例季标题");
    expect(bangumi.fileName).toBe("示例剧集标题");
    const lesson = previewNamingRule("{series_title}_{course_id}", 31);
    expect(lesson.ok).toBe(true);
    expect(lesson.fileName).toBe("示例课程标题_1000625147");
  });

  it("补齐位数的格式说明仍然生效", () => {
    const r = previewNamingRule("{number:03d}_{leaf_title}");
    expect(r.ok).toBe(true);
    expect(r.fileName).toBe("001_示例视频标题");
  });
});
