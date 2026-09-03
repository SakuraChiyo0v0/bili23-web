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
 * 任务创建时把"全局默认 + 本次覆盖"固化进任务快照（R-208：任务不受后续改设置影响）。
 */

export interface FileNamingConfig {
  rules: NamingRule[];
  /** NumberingType：0=FROM_SPECIFIED 1=USE_PARSE_LIST 2=CONTINUOUS */
  numberingType: number;
  /** 编号起始值（FROM_SPECIFIED / CONTINUOUS 用） */
  startingNumber: number;
}

export interface AppConfig {
  additional: ExtrasOptions;
  fileNaming: FileNamingConfig;
}

export function defaultAppConfig(): AppConfig {
  return {
    additional: DEFAULT_EXTRAS_OPTIONS,
    fileNaming: {
      rules: DEFAULT_NAMING_RULES.map((r) => ({ ...r })),
      numberingType: NumberingType.CONTINUOUS,
      startingNumber: 1,
    },
  };
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
      this.#config = merged;
    } catch {
      // 文件不存在/损坏：保持默认值并落盘
      await this.#persist(this.#config);
    }
  }

  /** 应用部分更新并持久化；返回更新后的完整配置 */
  async update(patch: Partial<AppConfig>): Promise<AppConfig> {
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
    const errors = validateNamingRules(next.fileNaming.rules);
    if (errors.length > 0) {
      throw new Error(`命名规则无效：${errors.join("；")}`);
    }
    if (![0, 1, 2].includes(next.fileNaming.numberingType)) {
      throw new Error("编号模式无效");
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
