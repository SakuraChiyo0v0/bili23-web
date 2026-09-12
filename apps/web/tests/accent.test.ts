import { describe, expect, it } from "vitest";
import { DEFAULT_ACCENT, DEFAULT_ACCENT_ALPHA, accentCss, isDefaultAccent, isLight } from "../src/client/lib/accentColor.js";

describe("强调色 alpha（原版 E21 取色器的 alpha 滑杆）", () => {
  it("不透明时原样返回 #RRGGBB（便于与 tokens.css 对照）", () => {
    expect(accentCss("#009faa", 100)).toBe("#009faa");
    expect(accentCss(DEFAULT_ACCENT, DEFAULT_ACCENT_ALPHA)).toBe(DEFAULT_ACCENT);
  });

  it("半透明时转成 rgba", () => {
    // #009faa → r=0 g=159 b=170；50% → 0.50
    expect(accentCss("#009faa", 50)).toBe("rgba(0, 159, 170, 0.50)");
    expect(accentCss("009faa", 0)).toBe("rgba(0, 159, 170, 0.00)");
    expect(accentCss("#ffffff", 10)).toBe("rgba(255, 255, 255, 0.10)");
  });

  it("越界/非整数会被夹紧并取整", () => {
    expect(accentCss("#009faa", 130)).toBe("#009faa");
    expect(accentCss("#009faa", -20)).toBe("rgba(0, 159, 170, 0.00)");
    expect(accentCss("#009faa", 49.6)).toBe("rgba(0, 159, 170, 0.50)");
  });

  it("isDefaultAccent 只认「默认色 + 不透明」", () => {
    expect(isDefaultAccent({ color: DEFAULT_ACCENT, alpha: 100 })).toBe(true);
    expect(isDefaultAccent({ color: "#009FAA", alpha: 100 })).toBe(true);
    expect(isDefaultAccent({ color: DEFAULT_ACCENT, alpha: 99 })).toBe(false);
    expect(isDefaultAccent({ color: "#123456", alpha: 100 })).toBe(false);
  });

  it("isLight 只看 RGB（半透明时的复合色不算）", () => {
    expect(isLight("#ffffff")).toBe(true);
    expect(isLight("#000000")).toBe(false);
    expect(isLight("#009faa")).toBe(false);
    expect(isLight("不是颜色")).toBe(false);
  });
});
