import { describe, expect, it } from "vitest";
import { parseLineNumbers } from "../src/client/lib/batchSelect.js";

describe("批量选择的行号解析（原版 batch_select.py:55-81）", () => {
  it("单个号与逗号分隔", () => {
    expect(parseLineNumbers("1,3,5")).toEqual({ ok: true, numbers: [1, 3, 5] });
  });

  it("范围：1-5 与 1..5 都支持，含中文逗号/分号", () => {
    expect(parseLineNumbers("1-3")).toEqual({ ok: true, numbers: [1, 2, 3] });
    expect(parseLineNumbers("1..3")).toEqual({ ok: true, numbers: [1, 2, 3] });
    expect(parseLineNumbers("1，3；5-6")).toEqual({ ok: true, numbers: [1, 3, 5, 6] });
  });

  it("重复号会去重", () => {
    expect(parseLineNumbers("2,2,2-3")).toEqual({ ok: true, numbers: [2, 3] });
  });

  it("三条失败文案与原版逐字一致", () => {
    expect(parseLineNumbers("")).toEqual({ ok: false, message: "请输入行号" });
    expect(parseLineNumbers("   ")).toEqual({ ok: false, message: "请输入行号" });
    expect(parseLineNumbers("5-3")).toEqual({ ok: false, message: "行号范围格式错误" });
    expect(parseLineNumbers("0-3")).toEqual({ ok: false, message: "行号范围格式错误" });
    expect(parseLineNumbers("abc")).toEqual({ ok: false, message: "行号格式错误" });
    expect(parseLineNumbers("1,abc")).toEqual({ ok: false, message: "行号格式错误" });
    expect(parseLineNumbers("0")).toEqual({ ok: false, message: "行号格式错误" });
    expect(parseLineNumbers("-3")).toEqual({ ok: false, message: "行号格式错误" });
  });

  it("不校验上界（与原版一致）：比序号列大的号照样解析出来", () => {
    expect(parseLineNumbers("99999")).toEqual({ ok: true, numbers: [99999] });
  });
});
