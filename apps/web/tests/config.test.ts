import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigStore, defaultAppConfig, validateConfig } from "../src/server/config.js";

async function makeStore(initial?: string): Promise<{ dir: string; file: string; store: ConfigStore }> {
  const dir = await mkdtemp(join(tmpdir(), "bili23-cfg-"));
  const file = join(dir, "config.json");
  if (initial !== undefined) await writeFile(file, initial, "utf8");
  const store = new ConfigStore(file);
  await store.load();
  return { dir, file, store };
}

async function cleanup(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

describe("ConfigStore 设置存储（download/behavior/advanced 组）", () => {
  it("旧 config.json 只含 additional/fileNaming 时补全新组默认值且不报错", async () => {
    const old = JSON.stringify({
      additional: { danmaku: { enabled: true } },
      fileNaming: { rules: [], numberingType: 2, startingNumber: 1 },
    });
    const { dir, store } = await makeStore(old);
    try {
      const cfg = store.get();
      expect(cfg.download).toEqual({
        dir: "",
        parallel: 2,
        threads: 4,
        speedLimitKbps: 0,
        renamePolicy: "auto",
        duplicatePolicy: "prompt",
        defaultContainer: "mp4",
      });
      expect(cfg.behavior).toEqual({ language: "system", theme: "system" });
      expect(cfg.advanced).toEqual({ cdnHosts: [] });
      // 旧组内容保留
      expect((cfg.additional.danmaku as { enabled?: boolean } | undefined)?.enabled).toBe(true);
    } finally {
      await cleanup(dir);
    }
  });

  it("缺失 config.json 时落盘默认值并补全新组", async () => {
    const { dir, file, store } = await makeStore(undefined);
    try {
      expect(store.get().download.parallel).toBe(2);
      const onDisk = JSON.parse(await readFile(file, "utf8"));
      expect(onDisk.download.speedLimitKbps).toBe(0);
      expect(onDisk.advanced.cdnHosts).toEqual([]);
    } finally {
      await cleanup(dir);
    }
  });

  it("update 校验并行数/线程数范围与限速非负（抛错不落盘）", async () => {
    const { dir, file, store } = await makeStore(undefined);
    try {
      await expect(store.update({ download: { parallel: 0 } })).rejects.toThrow(/parallel/);
      await expect(store.update({ download: { parallel: 17 } })).rejects.toThrow(/parallel/);
      await expect(store.update({ download: { threads: 3.5 } })).rejects.toThrow(/threads/);
      await expect(store.update({ download: { speedLimitKbps: -1 } })).rejects.toThrow(/speedLimitKbps/);
      // 校验失败后配置保持原样
      expect(store.get().download.parallel).toBe(2);
      const onDisk = JSON.parse(await readFile(file, "utf8"));
      expect(onDisk.download.parallel).toBe(2);
    } finally {
      await cleanup(dir);
    }
  });

  it("update 校验枚举合法性（language/theme/renamePolicy/duplicatePolicy/defaultContainer）", async () => {
    const { dir, store } = await makeStore(undefined);
    try {
      await expect(
        store.update({ behavior: { language: "fr" } } as never),
      ).rejects.toThrow(/language/);
      await expect(
        store.update({ behavior: { theme: "blue" } } as never),
      ).rejects.toThrow(/theme/);
      await expect(
        store.update({ download: { renamePolicy: "rename" } } as never),
      ).rejects.toThrow(/renamePolicy/);
      await expect(
        store.update({ download: { duplicatePolicy: "ask" } } as never),
      ).rejects.toThrow(/duplicatePolicy/);
      await expect(
        store.update({ download: { defaultContainer: "avi" } } as never),
      ).rejects.toThrow(/defaultContainer/);
    } finally {
      await cleanup(dir);
    }
  });

  it("合法 update 按组覆盖并持久化，重启读取保留", async () => {
    const { dir, file, store } = await makeStore(undefined);
    try {
      const next = await store.update({
        download: { speedLimitKbps: 500, parallel: 3 },
        behavior: { theme: "dark" },
        advanced: { cdnHosts: ["cdn.example.com"], defaultVideoQualityId: 80 },
      });
      expect(next.download.speedLimitKbps).toBe(500);
      expect(next.behavior.theme).toBe("dark");

      // 新实例重新读取
      const store2 = new ConfigStore(file);
      await store2.load();
      const cfg2 = store2.get();
      expect(cfg2.download.speedLimitKbps).toBe(500);
      expect(cfg2.download.parallel).toBe(3);
      expect(cfg2.behavior.theme).toBe("dark");
      expect(cfg2.advanced.cdnHosts).toEqual(["cdn.example.com"]);
      expect(cfg2.advanced.defaultVideoQualityId).toBe(80);
    } finally {
      await cleanup(dir);
    }
  });

  it("部分组更新不影响其他组（组级覆盖）", async () => {
    const { dir, store } = await makeStore(undefined);
    try {
      await store.update({ download: { parallel: 5 } });
      const cfg = store.get();
      expect(cfg.download.parallel).toBe(5);
      expect(cfg.download.threads).toBe(4); // 未更新保持默认
      expect(cfg.behavior.theme).toBe("system");
      expect(cfg.additional).toBeDefined();
      expect(cfg.fileNaming.numberingType).toBe(2);
    } finally {
      await cleanup(dir);
    }
  });
});

describe("validateConfig", () => {
  it("默认配置无错误", () => {
    expect(validateConfig(defaultAppConfig())).toEqual([]);
  });
});
