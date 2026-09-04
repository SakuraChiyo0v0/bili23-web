import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  ConventionType,
  DEFAULT_NAMING_RULES,
  DEFAULT_EXTRAS_OPTIONS,
  NumberingType,
  type ConventionTypeId,
  validateRule,
  variablesFor,
  type ExtrasOptions,
  type NamingRule,
} from "@bili23-web/engine";

/**
 * 全局设置存储（data/config.json）。
 * 键名分组对齐桌面 config.py：
 * - additional：附加内容默认值（结构 = ExtrasOptions）
 * - fileNaming：命名规则列表 + 编号模式
 * - download：下载（目录 / 并行任务数 / 分片并发 / 限速 / 重名与重复策略 / 默认容器）
 * - behavior：界面（语言 / 主题）
 * - advanced：高级（默认画质音质编码 / CDN / ffmpeg / 代理，本期持久化展示，运行语义归环境）
 * 任务创建时把"全局默认 + 本次覆盖"固化进任务快照（R-208：任务不受后续改设置影响）。
 */

export interface FileNamingConfig {
  rules: NamingRule[];
  /** NumberingType：0=FROM_SPECIFIED 1=USE_PARSE_LIST 2=CONTINUOUS */
  numberingType: number;
  /** 编号起始值（FROM_SPECIFIED / CONTINUOUS 用） */
  startingNumber: number;
}

/** 下载组（默认 parallel=2 / threads=4 / 不限速 / auto / prompt / mp4；dir 空 = 默认下载目录） */
export interface DownloadConfig {
  /** 下载目录；空字符串 = 默认下载目录（<data>/downloads） */
  dir: string;
  /** 并发任务数（1..16） */
  parallel: number;
  /** 单任务分片并发（1..16） */
  threads: number;
  /** 全局限速 KB/s；0 = 不限速 */
  speedLimitKbps: number;
  /** 产物重名策略：auto=自动改名 overwrite=覆盖 */
  renamePolicy: "auto" | "overwrite";
  /** 重复下载策略：prompt=询问 skip=跳过 force=强制下载 */
  duplicatePolicy: "prompt" | "skip" | "force";
  /** 默认输出容器 */
  defaultContainer: "mp4" | "mkv";
}

/** 界面/行为组（默认跟随系统） */
export interface BehaviorConfig {
  language: "zh-CN" | "zh-TW" | "en" | "system";
  theme: "light" | "dark" | "system";
  /** 解析成功后是否写入解析历史（对齐桌面 Behavior > 保存解析历史，默认开） */
  saveParseHistory: boolean;
  /** 点下载后是否自动弹出“下载选项”弹窗（对齐桌面 Behavior > 下载前弹下载选项框，默认开） */
  showDownloadOptionsDialog: boolean;
}

/** 高级组（默认全空；可选项缺省 = 不覆盖自动选择） */
export interface AdvancedConfig {
  defaultVideoQualityId?: number;
  defaultAudioQualityId?: number;
  defaultCodecId?: number;
  cdnHosts: string[];
  ffmpegPath?: string;
  proxy?: string;
}

export interface AppConfig {
  additional: ExtrasOptions;
  fileNaming: FileNamingConfig;
  download: DownloadConfig;
  behavior: BehaviorConfig;
  advanced: AdvancedConfig;
}

/** 配置部分更新（HTTP PUT 语义）：组内字段均可缺省，缺省组保持现值 */
export interface AppConfigPatch {
  additional?: Partial<ExtrasOptions>;
  fileNaming?: Partial<FileNamingConfig>;
  download?: Partial<DownloadConfig>;
  behavior?: Partial<BehaviorConfig>;
  advanced?: Partial<AdvancedConfig>;
}

const RENAME_POLICIES = ["auto", "overwrite"] as const;
const DUPLICATE_POLICIES = ["prompt", "skip", "force"] as const;
const CONTAINERS = ["mp4", "mkv"] as const;
const LANGUAGES = ["zh-CN", "zh-TW", "en", "system"] as const;
const THEMES = ["light", "dark", "system"] as const;

export function defaultAppConfig(): AppConfig {
  return {
    additional: DEFAULT_EXTRAS_OPTIONS,
    fileNaming: {
      rules: DEFAULT_NAMING_RULES.map((r) => ({ ...r })),
      numberingType: NumberingType.CONTINUOUS,
      startingNumber: 1,
    },
    download: {
      dir: "",
      parallel: 2,
      threads: 4,
      speedLimitKbps: 0,
      renamePolicy: "auto",
      duplicatePolicy: "prompt",
      defaultContainer: "mp4",
    },
    behavior: {
      language: "system",
      theme: "system",
      saveParseHistory: true,
      showDownloadOptionsDialog: true,
    },
    advanced: {
      cdnHosts: [],
    },
  };
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

/** 读文件时的下载组净化：越界/非法值回退默认，避免手改坏配置阻塞后续任何更新 */
function sanitizeDownload(raw: unknown): DownloadConfig {
  const def = defaultAppConfig().download;
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const intIn = (v: unknown, fallback: number, min: number, max: number): number => {
    const n = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : fallback;
    return Math.min(max, Math.max(min, n));
  };
  return {
    dir: typeof o.dir === "string" ? o.dir : def.dir,
    parallel: intIn(o.parallel, def.parallel, 1, 16),
    threads: intIn(o.threads, def.threads, 1, 16),
    speedLimitKbps:
      typeof o.speedLimitKbps === "number" && Number.isFinite(o.speedLimitKbps)
        ? Math.max(0, o.speedLimitKbps)
        : def.speedLimitKbps,
    renamePolicy: isOneOf(o.renamePolicy, RENAME_POLICIES) ? o.renamePolicy : def.renamePolicy,
    duplicatePolicy: isOneOf(o.duplicatePolicy, DUPLICATE_POLICIES) ? o.duplicatePolicy : def.duplicatePolicy,
    defaultContainer: isOneOf(o.defaultContainer, CONTAINERS) ? o.defaultContainer : def.defaultContainer,
  };
}

function sanitizeBehavior(raw: unknown): BehaviorConfig {
  const def = defaultAppConfig().behavior;
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    language: isOneOf(o.language, LANGUAGES) ? o.language : def.language,
    theme: isOneOf(o.theme, THEMES) ? o.theme : def.theme,
    saveParseHistory: typeof o.saveParseHistory === "boolean" ? o.saveParseHistory : def.saveParseHistory,
    showDownloadOptionsDialog:
      typeof o.showDownloadOptionsDialog === "boolean" ? o.showDownloadOptionsDialog : def.showDownloadOptionsDialog,
  };
}

function sanitizeAdvanced(raw: unknown): AdvancedConfig {
  const def = defaultAppConfig().advanced;
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const out: AdvancedConfig = {
    cdnHosts: Array.isArray(o.cdnHosts)
      ? (o.cdnHosts as unknown[]).filter((s): s is string => typeof s === "string")
      : def.cdnHosts,
  };
  const optNum = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined;
  const video = optNum(o.defaultVideoQualityId);
  if (video !== undefined) out.defaultVideoQualityId = video;
  const audio = optNum(o.defaultAudioQualityId);
  if (audio !== undefined) out.defaultAudioQualityId = audio;
  const codec = optNum(o.defaultCodecId);
  if (codec !== undefined) out.defaultCodecId = codec;
  if (typeof o.ffmpegPath === "string") out.ffmpegPath = o.ffmpegPath;
  if (typeof o.proxy === "string") out.proxy = o.proxy;
  return out;
}

/** 深合并（组/嵌套对象逐层覆盖；用于把本次下载选项覆盖到全局默认） */
export function deepMerge<T>(base: T, override: Partial<T> | undefined): T {
  if (override === undefined) return base;
  if (Array.isArray(base) || Array.isArray(override)) return (override as T) ?? base;
  if (typeof base === "object" && base !== null && typeof override === "object" && override !== null) {
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
      const existing = (base as Record<string, unknown>)[key];
      out[key] =
        typeof existing === "object" && existing !== null && typeof value === "object" && value !== null
          ? deepMerge(existing, value as Record<string, unknown>)
          : value;
    }
    return out as T;
  }
  return (override as T) ?? base;
}

/** 校验命名模板（引用变量必须在任一分类目录中存在）；返回错误文案数组 */
export function validateNamingRules(rules: NamingRule[]): string[] {
  const known = new Set<string>();
  for (const type of Object.values(ConventionType)) {
    for (const v of variablesFor(type as ConventionTypeId)) known.add(v.name);
  }
  const errors: string[] = [];
  for (const rule of rules) {
    if (!rule?.id || !rule?.name || typeof rule.rule !== "string") {
      errors.push("存在不完整的命名规则");
      continue;
    }
    if (!(Object.values(ConventionType) as number[]).includes(rule.type)) {
      errors.push(`规则 ${rule.name} 的类型 ${rule.type} 无效`);
    }
    for (const err of validateRule(rule.rule, known)) {
      errors.push(`规则 ${rule.name}：${err}`);
    }
  }
  return errors;
}

/** 校验 download/behavior/advanced 三组的类型与范围；返回错误文案数组（PUT 时 400） */
export function validateConfig(next: AppConfig): string[] {
  const errors: string[] = [];
  const dl = next.download;
  const be = next.behavior;
  const ad = next.advanced;
  const intInRange = (field: string, v: unknown): void => {
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 16) {
      errors.push(`${field} 需为 1..16 的整数`);
    }
  };
  intInRange("download.parallel", dl.parallel);
  intInRange("download.threads", dl.threads);
  if (typeof dl.dir !== "string") errors.push("download.dir 需为字符串");
  if (typeof dl.speedLimitKbps !== "number" || !Number.isFinite(dl.speedLimitKbps) || dl.speedLimitKbps < 0) {
    errors.push("download.speedLimitKbps 需为不小于 0 的数字");
  }
  if (!isOneOf(dl.renamePolicy, RENAME_POLICIES)) errors.push("download.renamePolicy 需为 auto 或 overwrite");
  if (!isOneOf(dl.duplicatePolicy, DUPLICATE_POLICIES)) {
    errors.push("download.duplicatePolicy 需为 prompt、skip 或 force");
  }
  if (!isOneOf(dl.defaultContainer, CONTAINERS)) errors.push("download.defaultContainer 需为 mp4 或 mkv");
  if (!isOneOf(be.language, LANGUAGES)) errors.push("behavior.language 需为 zh-CN、zh-TW、en 或 system");
  if (!isOneOf(be.theme, THEMES)) errors.push("behavior.theme 需为 light、dark 或 system");
  if (typeof be.saveParseHistory !== "boolean") errors.push("behavior.saveParseHistory 需为布尔值");
  if (typeof be.showDownloadOptionsDialog !== "boolean") errors.push("behavior.showDownloadOptionsDialog 需为布尔值");
  const nonNegative = (field: string, v: number | undefined): void => {
    if (v !== undefined && (typeof v !== "number" || !Number.isFinite(v) || v < 0)) {
      errors.push(`${field} 需为不小于 0 的数字`);
    }
  };
  nonNegative("advanced.defaultVideoQualityId", ad.defaultVideoQualityId);
  nonNegative("advanced.defaultAudioQualityId", ad.defaultAudioQualityId);
  nonNegative("advanced.defaultCodecId", ad.defaultCodecId);
  if (!Array.isArray(ad.cdnHosts) || ad.cdnHosts.some((s) => typeof s !== "string")) {
    errors.push("advanced.cdnHosts 需为字符串数组");
  }
  if (ad.ffmpegPath !== undefined && typeof ad.ffmpegPath !== "string") {
    errors.push("advanced.ffmpegPath 需为字符串");
  }
  if (ad.proxy !== undefined && typeof ad.proxy !== "string") {
    errors.push("advanced.proxy 需为字符串");
  }
  return errors;
}

export class ConfigStore {
  readonly #file: string;
  #config: AppConfig = defaultAppConfig();
  #loadPromise?: Promise<void>;
  #writeChain: Promise<void> = Promise.resolve();

  constructor(file: string) {
    this.#file = file;
  }

  /** 首次加载（幂等）；不存在则落盘默认值 */
  load(): Promise<void> {
    if (!this.#loadPromise) {
      this.#loadPromise = this.#read();
    }
    return this.#loadPromise;
  }

  get(): AppConfig {
    return this.#config;
  }

  async #read(): Promise<void> {
    try {
      const raw = await readFile(this.#file, "utf8");
      const parsed = JSON.parse(raw) as Partial<AppConfig>;
      const merged = defaultAppConfig();
      if (parsed.additional && typeof parsed.additional === "object") {
        merged.additional = deepMerge(merged.additional, parsed.additional);
      }
      if (parsed.fileNaming && typeof parsed.fileNaming === "object") {
        const fn = parsed.fileNaming;
        if (Array.isArray(fn.rules) && fn.rules.length > 0) merged.fileNaming.rules = fn.rules as NamingRule[];
        if (fn.numberingType !== undefined) merged.fileNaming.numberingType = fn.numberingType;
        if (fn.startingNumber !== undefined && Number.isFinite(fn.startingNumber)) {
          merged.fileNaming.startingNumber = Math.max(1, Math.floor(fn.startingNumber));
        }
      }
      // 旧 config.json 缺省 download/behavior/advanced 时深合并默认值，不报错
      if (parsed.download !== undefined) merged.download = sanitizeDownload(parsed.download);
      if (parsed.behavior !== undefined) merged.behavior = sanitizeBehavior(parsed.behavior);
      if (parsed.advanced !== undefined) merged.advanced = sanitizeAdvanced(parsed.advanced);
      this.#config = merged;
    } catch {
      // 文件不存在/损坏：保持默认值并落盘
      await this.#persist(this.#config);
    }
  }

  /** 应用部分更新并持久化；返回更新后的完整配置（download/behavior/advanced 按组覆盖并校验） */
  async update(patch: AppConfigPatch): Promise<AppConfig> {
    const next = defaultAppConfig();
    const current = this.#config;
    if (patch.additional && typeof patch.additional === "object") {
      next.additional = deepMerge(current.additional, patch.additional);
    } else {
      next.additional = current.additional;
    }
    if (patch.fileNaming && typeof patch.fileNaming === "object") {
      const fn = patch.fileNaming;
      next.fileNaming = {
        rules: Array.isArray(fn.rules) && fn.rules.length > 0 ? (fn.rules as NamingRule[]) : current.fileNaming.rules,
        numberingType: fn.numberingType !== undefined ? fn.numberingType : current.fileNaming.numberingType,
        startingNumber:
          fn.startingNumber !== undefined && Number.isFinite(fn.startingNumber)
            ? Math.max(1, Math.floor(fn.startingNumber))
            : current.fileNaming.startingNumber,
      };
    } else {
      next.fileNaming = current.fileNaming;
    }
    if (patch.download && typeof patch.download === "object") {
      next.download = deepMerge(current.download, patch.download);
    } else {
      next.download = current.download;
    }
    if (patch.behavior && typeof patch.behavior === "object") {
      next.behavior = deepMerge(current.behavior, patch.behavior);
    } else {
      next.behavior = current.behavior;
    }
    if (patch.advanced && typeof patch.advanced === "object") {
      next.advanced = deepMerge(current.advanced, patch.advanced);
    } else {
      next.advanced = current.advanced;
    }
    const errors = [...validateNamingRules(next.fileNaming.rules), ...validateConfig(next)];
    if (![0, 1, 2].includes(next.fileNaming.numberingType)) {
      errors.push("编号模式无效");
    }
    if (errors.length > 0) {
      throw new Error(`配置无效：${errors.join("；")}`);
    }
    this.#config = next;
    await this.#persist(next);
    return next;
  }

  async #persist(config: AppConfig): Promise<void> {
    const serialized = JSON.stringify(config, null, 2);
    this.#writeChain = this.#writeChain.then(async () => {
      await mkdir(dirname(this.#file), { recursive: true });
      await writeFile(this.#file, serialized, "utf8");
    });
    await this.#writeChain;
  }
}
