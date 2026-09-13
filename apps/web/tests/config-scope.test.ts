import { afterEach, describe, expect, it } from "vitest";
import { allowedRoots, isPathAllowed } from "../src/server/config.js";

/**
 * 存储范围（`BILI23_ALLOWED_ROOTS`）—— 部署级限制：应用只能读写指定范围内的目录。
 * 这是安全边界，必须挡住"前缀相似"这种绕过。
 */
describe("存储范围（allowedRoots / isPathAllowed）", () => {
  const original = process.env.BILI23_ALLOWED_ROOTS;
  afterEach(() => {
    if (original === undefined) delete process.env.BILI23_ALLOWED_ROOTS;
    else process.env.BILI23_ALLOWED_ROOTS = original;
  });

  it("未配置时不限制（本地开发就是这种）", () => {
    delete process.env.BILI23_ALLOWED_ROOTS;
    expect(allowedRoots()).toEqual([]);
    expect(isPathAllowed("/etc/passwd")).toBe(true);
    expect(isPathAllowed("C:\\Windows")).toBe(true);
  });

  it("配置后解析成绝对路径（支持 ; 与 , 分隔）", () => {
    process.env.BILI23_ALLOWED_ROOTS = "/volume1;/home, /data";
    const roots = allowedRoots();
    expect(roots).toHaveLength(3);
    expect(roots.some((r) => r.endsWith("volume1"))).toBe(true);
    expect(roots.some((r) => r.endsWith("home"))).toBe(true);
  });

  it("范围内允许、范围外拒绝", () => {
    process.env.BILI23_ALLOWED_ROOTS = "/volume1;/home";
    expect(isPathAllowed("/volume1/bili23-downloads")).toBe(true);
    expect(isPathAllowed("/volume1")).toBe(true);
    expect(isPathAllowed("/home/AmeChan/Videos")).toBe(true);
    expect(isPathAllowed("/etc")).toBe(false);
    expect(isPathAllowed("/")).toBe(false);
    expect(isPathAllowed("/volume2/media")).toBe(false);
  });

  it("前缀相似的目录不放过（/volume1x 不在 /volume1 里）", () => {
    process.env.BILI23_ALLOWED_ROOTS = "/volume1";
    expect(isPathAllowed("/volume1x")).toBe(false);
    expect(isPathAllowed("/volume1x/media")).toBe(false);
    expect(isPathAllowed("/volume1/media")).toBe(true);
  });

  it("相对路径按服务进程的工作目录解析后再判断", () => {
    process.env.BILI23_ALLOWED_ROOTS = process.cwd();
    expect(isPathAllowed(".")).toBe(true);
    expect(isPathAllowed("./downloads")).toBe(true);
    expect(isPathAllowed("../..")).toBe(false);
  });
});
