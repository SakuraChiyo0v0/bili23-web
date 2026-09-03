import { describe, expect, it } from "vitest";
import { CookieJar } from "../src/api/cookies.js";

describe("CookieJar", () => {
  it("从请求头字符串解析", () => {
    const jar = CookieJar.parse("SESSDATA=abc123; bili_jct=xyz; Path=/");
    expect(jar.get("SESSDATA")).toBe("abc123");
    expect(jar.get("bili_jct")).toBe("xyz");
    expect(jar.get("Path")).toBeUndefined();
  });

  it("空输入不产生 cookie", () => {
    expect(CookieJar.parse(undefined).toHeader()).toBeUndefined();
    expect(CookieJar.parse("").toHeader()).toBeUndefined();
  });

  it("set/get/delete/has", () => {
    const jar = new CookieJar();
    jar.set("a", "1");
    jar.set("b", "2");
    expect(jar.has("a")).toBe(true);
    jar.delete("a");
    expect(jar.has("a")).toBe(false);
    expect(jar.snapshot()).toEqual({ b: "2" });
  });

  it("toHeader 只含有效键值且按插入序", () => {
    const jar = new CookieJar();
    jar.set("SESSDATA", "v1");
    jar.set("bili_jct", "v2");
    expect(jar.toHeader()).toBe("SESSDATA=v1; bili_jct=v2");
  });

  it("updateFromSetCookie 提取 name=value 并忽略属性", () => {
    const jar = new CookieJar();
    jar.updateFromSetCookie([
      "SESSDATA=abc; Path=/; Domain=.bilibili.com; HttpOnly",
      "buvid3=xyz=123; Path=/",
    ]);
    expect(jar.get("SESSDATA")).toBe("abc");
    expect(jar.get("buvid3")).toBe("xyz=123");
  });
});
