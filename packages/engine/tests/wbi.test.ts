import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { getMixinKey, pyQuotePlus, wbiSign, MIXIN_KEY_ENC_TAB } from "../src/api/wbi.js";

const IMG_KEY = "7cd084941338484aae1ad9425b84077c";
const SUB_KEY = "4932caff0ff746eab6f01bf08b70ac45";

describe("wbi 签名", () => {
  it("混排表长度与取值合法（64 项，均在 0..63），首尾抄录校验", () => {
    expect(MIXIN_KEY_ENC_TAB.length).toBe(64);
    for (const i of MIXIN_KEY_ENC_TAB) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(64);
    }
    expect([...MIXIN_KEY_ENC_TAB.slice(0, 6)]).toEqual([46, 47, 18, 2, 53, 8]);
    // 与 Python 源码末尾一段一致：...63, 57, 62, 11, 36, 20, 34, 44, 52
    expect([...MIXIN_KEY_ENC_TAB.slice(-9)]).toEqual([63, 57, 62, 11, 36, 20, 34, 44, 52]);
  });

  it("mixin key 稳定且依赖两个 key", () => {
    const a = getMixinKey(IMG_KEY, SUB_KEY);
    const b = getMixinKey(IMG_KEY, SUB_KEY);
    expect(a).toBe(b);
    expect(a).toHaveLength(32);
    expect(a).not.toBe(getMixinKey("0".repeat(32), SUB_KEY));
  });

  it("签名包含 wts 与 32 位 hex w_rid，且可被独立重算验证", () => {
    const now = 1700000000;
    const signed = wbiSign({ foo: "114", bar: "514", zab: 1919810 }, IMG_KEY, SUB_KEY, now);
    expect(signed["wts"]).toBe(String(now));
    expect(signed["w_rid"]).toMatch(/^[0-9a-f]{32}$/);

    const mixinKey = getMixinKey(IMG_KEY, SUB_KEY);
    const clean: Record<string, string> = { wts: String(now), foo: "114", bar: "514", zab: "1919810" };
    const qs = Object.keys(clean)
      .sort()
      .map((k) => `${k}=${pyQuotePlus(clean[k] ?? "")}`)
      .join("&");
    expect(signed["w_rid"]).toBe(createHash("md5").update(qs + mixinKey).digest("hex"));
  });

  it("值中的 !'()* 会被过滤", () => {
    const signed = wbiSign({ kw: "a!'()*b" }, IMG_KEY, SUB_KEY, 0);
    expect(signed["kw"]).toBe("ab");
  });

  it("pyQuotePlus：保留字母数字与 _.-~，空格转 +，其余百分号大写", () => {
    expect(pyQuotePlus("abcXYZ019_-.~")).toBe("abcXYZ019_-.~");
    expect(pyQuotePlus("a b")).toBe("a+b");
    expect(pyQuotePlus("你好")).toBe("%E4%BD%A0%E5%A5%BD");
  });

  it("同参数同时间签名确定（幂等）", () => {
    const s1 = wbiSign({ id: "123" }, IMG_KEY, SUB_KEY, 9);
    const s2 = wbiSign({ id: "123" }, IMG_KEY, SUB_KEY, 9);
    expect(s1).toEqual(s2);
  });
});
