import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigStore, defaultAppConfig, resolveCdnHosts, resolveProxyUrl, validateConfig } from "../src/server/config.js";

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
        // 产物默认落点（设置页「下载路径」卡的 NAS / 本机 模式）
        deliver: "server",
        // 仅纯音频流时把 m4a 转 mp3（桌面 config.py:364，默认关）
        m4aToMp3: false,
        // 旧 config.json 没有这三个数组 → 补成桌面版默认值（config.py:73-100）
        videoQualityPriority: [127, 126, 125, 122, 120, 116, 112, 100, 80, 64, 32, 16],
        audioQualityPriority: [30251, 30250, 30280, 30232, 30216],
        videoCodecPriority: [7, 12, 13],
      });
      expect(cfg.behavior).toEqual({
        language: "system",
        theme: "system",
        // 动效偏好（我们自己的设置，默认流畅）
        motion: "smooth",
        saveParseHistory: true,
        showDownloadOptionsDialog: true,
        // 预分配文件空间（桌面 Behavior 组，默认开）
        preallocateFileSpace: true,
        // 监听剪贴板（桌面默认关；Web 改写为聚焦时读一次）
        monitorClipboard: false,
        autoSelectMode: "conditional",
        autoSelectConditions: { userUploads: 0, bangumi: 0, other: 0 },
        // 分页那一族（桌面 Misc 组，config.py:481-483）：默认不自动弹、间隔 2 秒、不自动加下载列表
        showAutoParseDialog: false,
        autoParseInterval: 2,
        autoAddToDownloadList: false,
      });
      // 高级组：旧 config.json 没有这些字段 → 全部补成桌面版默认值
      expect(cfg.advanced).toEqual({
        cnCdnHosts: [],
        ovCdnHosts: [],
        preferCdnServerProvider: true,
        area: "cn",
        proxyMode: "system",
        proxyType: "http",
        proxyServer: "",
        proxyPort: 80,
        proxyUname: "",
        proxyPassword: "",
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 Edg/147.0.0.0",
        // MCP：默认关闭、端口 23330、回环（与原版 config.py:415-417 一致）
        mcpEnabled: false,
        mcpPort: 23330,
        mcpToken: "",
        mcpBindAddress: "127.0.0.1",
      });
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
      expect(onDisk.advanced.cnCdnHosts).toEqual([]);
      expect(onDisk.advanced.ovCdnHosts).toEqual([]);
    } finally {
      await cleanup(dir);
    }
  });

  /**
   * 三个优先级数组的净化规则（桌面版 config.py:73-100 的对应物）：
   * 必须是**非空**的数字数组；脏数据整体回退默认 —— 半截数组比默认值更糟
   * （引擎拿它当"自动选择"的排序依据，缺档会让本来能选到的高画质选不到）。
   */
  it("优先级数组：非法/空/含非数字 → 整体回退默认值", async () => {
    for (const bad of ["[]", '"127,126"', "[127, null]", '[127, "126"]', "{}", "123"]) {
      const { dir, store } = await makeStore(`{"download":{"videoQualityPriority":${bad}}}`);
      try {
        expect(store.get().download.videoQualityPriority).toEqual([127, 126, 125, 122, 120, 116, 112, 100, 80, 64, 32, 16]);
      } finally {
        await cleanup(dir);
      }
    }
  });

  it("优先级数组：去重保序，合法值原样保留", async () => {
    const { dir, store } = await makeStore('{"download":{"videoCodecPriority":[13,7,13,12]}}');
    try {
      expect(store.get().download.videoCodecPriority).toEqual([13, 7, 12]);
    } finally {
      await cleanup(dir);
    }
  });

  it("优先级数组：单元素数组是合法的（用户就想要某一个档位）", async () => {
    const { dir, store } = await makeStore('{"download":{"audioQualityPriority":[30216]}}');
    try {
      expect(store.get().download.audioQualityPriority).toEqual([30216]);
    } finally {
      await cleanup(dir);
    }
  });

  it("优先级数组：空数组会被 validateConfig 拒绝（PUT 400）", () => {
    const cfg = defaultAppConfig();
    cfg.download.videoQualityPriority = [];
    const errors = validateConfig(cfg);
    expect(errors.some((e) => e.includes("videoQualityPriority"))).toBe(true);
  });

  /**
   * 代理三态与 CDN 区域选择（桌面 `config.py:395-408`）：
   * 这两条都是"看着像配置、实际会改变请求走向"的规则，值得钉住。
   */
  describe("代理与 CDN 的取值规则", () => {
    const base = () => defaultAppConfig().advanced;

    it("resolveProxyUrl：只有 manual + 有地址才给 URL；用户名密码会 URL 编码", () => {
      expect(resolveProxyUrl({ ...base(), proxyMode: "disabled", proxyServer: "h" })).toBeUndefined();
      expect(resolveProxyUrl({ ...base(), proxyMode: "system", proxyServer: "h" })).toBeUndefined();
      // manual 但没地址 → 直连（校验会另拦一道）
      expect(resolveProxyUrl({ ...base(), proxyMode: "manual", proxyServer: "  " })).toBeUndefined();
      expect(resolveProxyUrl({ ...base(), proxyMode: "manual", proxyServer: "127.0.0.1", proxyPort: 7890 }))
        .toBe("http://127.0.0.1:7890");
      expect(resolveProxyUrl({ ...base(), proxyMode: "manual", proxyServer: "p.example", proxyPort: 8080, proxyUname: "a b", proxyPassword: "p@ss" }))
        .toBe("http://a%20b:p%40ss@p.example:8080");
    });

    it("resolveCdnHosts：按区域取一份；开关关掉就一份都不用", () => {
      const ad = { ...base(), cnCdnHosts: ["cn1", "cn2"], ovCdnHosts: ["ov1"] };
      expect(resolveCdnHosts({ ...ad, area: "cn" })).toEqual(["cn1", "cn2"]);
      expect(resolveCdnHosts({ ...ad, area: "ov" })).toEqual(["ov1"]);
      expect(resolveCdnHosts({ ...ad, area: "cn", preferCdnServerProvider: false })).toEqual([]);
    });

    it("校验：空 UA / manual 无地址 / 端口越界都会被拒", () => {
      const bad = defaultAppConfig();
      bad.advanced.userAgent = "   ";
      expect(validateConfig(bad).some((e) => e.includes("userAgent"))).toBe(true);

      const noServer = defaultAppConfig();
      noServer.advanced.proxyMode = "manual";
      noServer.advanced.proxyServer = "";
      expect(validateConfig(noServer).some((e) => e.includes("proxyServer") || e.includes("proxyMode"))).toBe(true);

      const badPort = defaultAppConfig();
      badPort.advanced.proxyPort = 70000;
      expect(validateConfig(badPort).some((e) => e.includes("proxyPort"))).toBe(true);
    });

    it("读盘净化：端口越界回默认 80、空 UA 回默认、非法模式回 system", async () => {
      const { dir, store } = await makeStore(
        '{"advanced":{"proxyPort":70000,"userAgent":"","proxyMode":"nonsense","area":"mars"}}',
      );
      try {
        const ad = store.get().advanced;
        expect(ad.proxyPort).toBe(80);
        expect(ad.userAgent).toContain("Mozilla/5.0");
        expect(ad.proxyMode).toBe("system");
        expect(ad.area).toBe("cn");
      } finally {
        await cleanup(dir);
      }
    });
  });

  it("update 校验并行数/线程数范围与限速非负（抛错不落盘）", async () => {    const { dir, file, store } = await makeStore(undefined);
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
        advanced: {
          cnCdnHosts: ["cdn.example.com"],
          ovCdnHosts: ["ov.example.com"],
          defaultVideoQualityId: 80,
        },
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
      expect(cfg2.advanced.cnCdnHosts).toEqual(["cdn.example.com"]);
      expect(cfg2.advanced.ovCdnHosts).toEqual(["ov.example.com"]);
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

describe("配置导入 / 导出 / 重置（原版「配置文件设置」卡）", () => {
  it("导出 → 导入 往返：改过的值原样回来", async () => {
    const { dir, store } = await makeStore(undefined);
    try {
      await store.update({ download: { parallel: 7 }, behavior: { theme: "dark" } });
      const exported = await store.exportAll();
      expect(exported.download.parallel).toBe(7);
      expect(exported.behavior.theme).toBe("dark");

      // 换一个 store（模拟"导入到另一台机器"）
      const other = await makeStore(undefined);
      try {
        const applied = await other.store.replaceAll(exported);
        expect(applied.download.parallel).toBe(7);
        expect(applied.behavior.theme).toBe("dark");
        // 落盘了才算数
        const onDisk = JSON.parse(await readFile(other.file, "utf8"));
        expect(onDisk.download.parallel).toBe(7);
      } finally { await cleanup(other.dir); }
    } finally { await cleanup(dir); }
  });

  it("导入非法值：数字被夹紧、枚举回退默认，不报错", async () => {
    const { dir, store } = await makeStore(undefined);
    try {
      const applied = await store.replaceAll({ download: { parallel: 99, threads: "x" }, behavior: { theme: "nonsense" } });
      // 注意：数值净化是**夹到区间上界**（99→16），非数字才回退默认（x→4）；枚举非法回退默认
      expect(applied.download.parallel).toBe(16);
      expect(applied.download.threads).toBe(4);
      expect(applied.behavior.theme).toBe("system");
    } finally { await cleanup(dir); }
  });

  it("导入后校验不过的（启用 MCP 却没令牌）→ 抛错且**不落盘**", async () => {
    const { dir, file, store } = await makeStore(undefined);
    try {
      await store.update({ download: { parallel: 5 } });
      await expect(store.replaceAll({ advanced: { mcpEnabled: true, mcpToken: "" } })).rejects.toThrow(/mcpToken/);
      // 失败后配置与磁盘都保持原样
      expect(store.get().download.parallel).toBe(5);
      const onDisk = JSON.parse(await readFile(file, "utf8"));
      expect(onDisk.download.parallel).toBe(5);
    } finally { await cleanup(dir); }
  });

  it("重置：回到默认值并落盘", async () => {
    const { dir, file, store } = await makeStore(undefined);
    try {
      await store.update({ download: { parallel: 9, dir: "/x" } });
      const after = await store.resetAll();
      expect(after.download.parallel).toBe(2);
      expect(after.download.dir).toBe("");
      const onDisk = JSON.parse(await readFile(file, "utf8"));
      expect(onDisk.download.parallel).toBe(2);
    } finally { await cleanup(dir); }
  });
});