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
      expect(cfg.behavior).toEqual({ language: "system", theme: "system", saveParseHistory: true, showDownloadOptionsDialog: true });
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

  it("behavior 新开关默认开且可持久化，重启保留", async () => {
    const { dir, file, store } = await makeStore(undefined);
    try {
      expect(store.get().behavior.saveParseHistory).toBe(true);
      expect(store.get().behavior.showDownloadOptionsDialog).toBe(true);
      const next = await store.update({
        behavior: { saveParseHistory: false, showDownloadOptionsDialog: false },
      });
      expect(next.behavior.saveParseHistory).toBe(false);
      expect(next.behavior.showDownloadOptionsDialog).toBe(false);
      const store2 = new ConfigStore(file);
      await store2.load();
      expect(store2.get().behavior.saveParseHistory).toBe(false);
      expect(store2.get().behavior.showDownloadOptionsDialog).toBe(false);
    } finally {
      await cleanup(dir);
    }
  });

  it("update 校验 behavior 开关必须为布尔", async () => {
    const { dir, store } = await makeStore(undefined);
    try {
      await expect(
        store.update({ behavior: { saveParseHistory: "yes" } } as never),
      ).rejects.toThrow(/saveParseHistory/);
      await expect(
        store.update({ behavior: { showDownloadOptionsDialog: 1 } } as never),
      ).rejects.toThrow(/showDownloadOptionsDialog/);
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

it("附加内容：字幕指定语言/内嵌后删除可持久化，重启读取保留", async () => {
    const { dir, file, store } = await makeStore(undefined);
    try {
      const next = await store.update({
        additional: {
          subtitle: {
            enabled: true,
            format: "ass",
            language: { downloadSpecified: true, specifiedLanguages: ["zh", "en", "ai-zh"] },
            style: { font: { name: "黑体", size: 36, bold: false, italic: false, underline: false, strike: false }, border: { border: 1, shadow: 0 }, color: { primary: "&H00FFFFFF", secondary: "&H000000FF", border: "H00000000", shadow: "H00000000" }, margin: { left: 10, right: 10, vertical: 20 }, resolution: { width: 1280, height: 720 }, alignment: 2 },
            embed: true,
            deleteAfterEmbed: true,
          },
          danmaku: { enabled: true, format: "ass", embed: true, deleteAfterEmbed: true, style: { font: { name: "黑体", size: 36, bold: false, italic: false, underline: false, strike: false }, border: { border: 1, shadow: 0 }, advanced: { displayArea: 60, opacity: 80, scrollDuration: 10, staticDuration: 5, minimumGap: 100 }, resolution: { width: 1280, height: 720 } } },
          cover: { enabled: true, format: "jpg", attach: true, deleteAfterAttach: true },
        },
      });
      expect(next.additional.subtitle?.language).toEqual({ downloadSpecified: true, specifiedLanguages: ["zh", "en", "ai-zh"] });
      expect(next.additional.subtitle?.deleteAfterEmbed).toBe(true);

      const store2 = new ConfigStore(file);
      await store2.load();
      const cfg2 = store2.get();
      const lang = cfg2.additional.subtitle?.language as { specifiedLanguages?: string[] } | undefined;
      expect(lang?.specifiedLanguages).toEqual(["zh", "en", "ai-zh"]);
      expect(cfg2.additional.subtitle?.deleteAfterEmbed).toBe(true);
      expect(cfg2.additional.danmaku?.deleteAfterEmbed).toBe(true);
      expect(cfg2.additional.cover?.deleteAfterAttach).toBe(true);
    } finally {
      await cleanup(dir);
    }
  });

describe("validateConfig", () => {
  it("默认配置无错误", () => {
    expect(validateConfig(defaultAppConfig())).toEqual([]);
  });
});
