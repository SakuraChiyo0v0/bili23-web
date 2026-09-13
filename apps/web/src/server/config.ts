import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
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
  /**
   * 产物默认送到哪里（设置页「下载路径」卡的 NAS / 本机 模式）：
   * - `server`：下到上面的下载目录（NAS），进产物库
   * - `local`：下到投递目录，取回本机后即删（下载选项弹窗里的「保存到」默认值就是它）
   */
  deliver: "server" | "local";
  /**
   * 仅下载音频流时把 m4a 转成 mp3（桌面 `config.py:364`，默认关）。
   * 桌面卡片描述：「仅下载音频流时生效。若同时选择了视频则禁用。」
   */
  m4aToMp3: boolean;
  /**
   * 画质优先级 / 音质优先级 / 编码优先级（对齐原版 `config.py:73-100` 的三个数组）。
   * 引擎 `resolver` 早就支持这三个数组，之前只是**没有任何 config 字段产生它们** ——
   * 于是「按优先级自动选择」用的是引擎内置默认值，用户改不了。
   */
  videoQualityPriority: number[];
  audioQualityPriority: number[];
  videoCodecPriority: number[];
}

/** 原版三项优先级的默认值（`config.py:73-100`，逐项照抄） */
export const DEFAULT_VIDEO_QUALITY_PRIORITY = [127, 126, 125, 122, 120, 116, 112, 100, 80, 64, 32, 16];
export const DEFAULT_AUDIO_QUALITY_PRIORITY = [30251, 30250, 30280, 30232, 30216];
export const DEFAULT_VIDEO_CODEC_PRIORITY = [7, 12, 13];

/** 条件式自动勾选的三类条件（0 = 仅链接指向的那一项；1 = 该类的全部） */
export interface AutoSelectConditions {
  userUploads: 0 | 1;
  bangumi: 0 | 1;
  other: 0 | 1;
}

/** 界面/行为组（默认跟随系统） */
export interface BehaviorConfig {
  language: "zh-CN" | "zh-TW" | "en" | "system";
  theme: "light" | "dark" | "system";
  /**
   * 动效偏好（我们自己的设置，原版没有）：`smooth` 流畅 / `reduced` 精简。
   * 放在 config 里与 theme 同样待遇 —— 跨设备同步；localStorage 只做首屏镜像
   *（`ui.motion`，给 React 渲染前的第一帧用）。
   */
  motion: "smooth" | "reduced";
  /** 解析成功后是否写入解析历史（对齐桌面 Behavior > 保存解析历史，默认开） */
  saveParseHistory: boolean;
  /** 点下载后是否自动弹出“下载选项”弹窗（对齐桌面 Behavior > 下载前弹下载选项框，默认开） */
  showDownloadOptionsDialog: boolean;
  /**
   * 下载前预分配文件空间（桌面 `config.py:348`，**默认开**）。
   * 桌面实现是稀疏预置逻辑大小（`f.seek(size-1); f.write(b"\0")`），引擎侧等价于 `truncate(size)`。
   */
  preallocateFileSpace: boolean;
  /**
   * 监听剪贴板（桌面 `config.py` 的 `monitor_clipboard`，**默认关**）。
   *
   * ⚠️ Web 改写：浏览器不能后台轮询系统剪贴板，所以只在**页面重新聚焦时读一次**，
   * 命中链接**只填入输入框并提示**，由用户点「解析」——
   * 不自动解析、更不自动下载（剪贴板里什么都可能有）。
   */
  monitorClipboard: boolean;
  /** 解析后自动勾选策略（对齐桌面 config.py:331 auto_select_mode_，默认条件式） */
  autoSelectMode: "manual" | "all" | "conditional";
  /** 条件式的三类条件（对齐桌面 config.py:332 auto_select_conditions） */
  autoSelectConditions: AutoSelectConditions;
  /**
   * 结果带分页时是否直接弹出「自动解析分页」对话框（桌面 `config.py:481`，**默认关**）。
   * 关着的时候先显示教学气泡。
   *
   * 对照：桌面还有个 `auto_parse_teaching_tip_shown_`（`config.py:485`，属性名带尾下划线）
   * 记录"教学气泡是否已看过"。它是**浏览器侧的一次性引导状态**、不是下载行为，
   * 所以 Web 端放 localStorage（`bili23.teaching.autoParse`），**不进服务端配置**。
   */
  showAutoParseDialog: boolean;
  /** 自动解析分页时每页之间的间隔秒数（桌面 `config.py:483`，默认 2.0） */
  autoParseInterval: number;
  /** 每解析完一页/一条链接后自动加入下载列表（桌面 `config.py:482`，默认关；两个对话框共用） */
  autoAddToDownloadList: boolean;
}

/** 代理模式（对齐桌面 `ProxyMode`，`enum.py:63-66`） */
export type ProxyMode = "disabled" | "system" | "manual";
/** 代理类型（桌面 `ProxyType` 目前只有 http，socks 在源码里是注释掉的） */
export type ProxyType = "http";
/** 地理位置（对齐桌面 `Area`，`enum.py:175-177`）：大陆 / 大陆以外 */
export type Area = "cn" | "ov";

export const PROXY_MODES: readonly ProxyMode[] = ["disabled", "system", "manual"];
export const PROXY_TYPES: readonly ProxyType[] = ["http"];
export const AREAS: readonly Area[] = ["cn", "ov"];

/** 桌面 `config.py:410` 的默认 UA 逐字照抄（Edge on Windows） */
export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 Edg/147.0.0.0";

/** 高级组（默认全空；可选项缺省 = 不覆盖自动选择） */
export interface AdvancedConfig {
  defaultVideoQualityId?: number;
  defaultAudioQualityId?: number;
  defaultCodecId?: number;
  /** 大陆 CDN 节点（对齐桌面 cn_cdn_server_list），取流时重写 host 用 */
  cnCdnHosts: string[];
  /** 海外 CDN 节点（对齐桌面 ov_cdn_server_list），取流时重写 host 用 */
  ovCdnHosts: string[];
  /** 优先使用服务商 CDN（桌面 `prefer_cdn_server_provider_`，默认开） */
  preferCdnServerProvider: boolean;
  /** 地理位置：决定用上面哪一份 CDN 列表（桌面 `area`，默认大陆） */
  area: Area;
  ffmpegPath?: string;
  /**
   * 代理 —— 结构化，对齐桌面 `proxy_mode` / `proxy_type` / `proxy_server` / `proxy_port` /
   * `proxy_uname` / `proxy_password`（`config.py:403-408`）。
   * 之前这里是一个 `proxy?: string`（`http://host:port`），没有三态、没有用户名密码；
   * 按本项目"不留兼容层"的约定，那一个字段**已删除**，改成下面这组。
   */
  proxyMode: ProxyMode;
  proxyType: ProxyType;
  proxyServer: string;
  proxyPort: number;
  proxyUname: string;
  proxyPassword: string;
  /** 自定义 User-Agent（桌面 `user_agent`，默认见 DEFAULT_USER_AGENT） */
  userAgent: string;
  /**
   * MCP 服务器（桌面 `config.py:415-417` 的 `mcp_enabled`/`mcp_port`/`mcp_token`）。
   * 默认**关闭**，与原版一致 —— 它给 AI 客户端开放"解析 + 建下载任务"的能力，必须显式启用。
   */
  mcpEnabled: boolean;
  /** 监听端口（桌面默认 23330，范围 1024–65535） */
  mcpPort: number;
  /** 访问令牌（首次启用时自动生成；每个请求都要带） */
  mcpToken: string;
  /**
   * 监听地址 —— **原版没有这个字段**（它硬编码 `127.0.0.1`，因为桌面程序只服务本机）。
   *
   * ⚠️ 这条是**为 Web/NAS 场景补的**：bili23-web 跑在 NAS 上，
   * 若只回环，除了 NAS 自己谁也连不上 MCP，功能等于不可用。
   * 默认仍是 `127.0.0.1`（与原版一致、最安全），要开放到局域网必须**显式**把它改成 `0.0.0.0`。
   */
  mcpBindAddress: string;
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
/** 产物落点：server=下载目录（NAS）/ local=投递目录（取回本机后即删） */
const DELIVER_MODES = ["server", "local"] as const;
const CONTAINERS = ["mp4", "mkv"] as const;
const LANGUAGES = ["zh-CN", "zh-TW", "en", "system"] as const;
const THEMES = ["light", "dark", "system"] as const;
const MOTIONS = ["smooth", "reduced"] as const;
const AUTO_SELECT_MODES = ["manual", "all", "conditional"] as const;

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
      deliver: "server",
      m4aToMp3: false,
      videoQualityPriority: [...DEFAULT_VIDEO_QUALITY_PRIORITY],
      audioQualityPriority: [...DEFAULT_AUDIO_QUALITY_PRIORITY],
      videoCodecPriority: [...DEFAULT_VIDEO_CODEC_PRIORITY],
    },
    behavior: {
      language: "system",
      theme: "system",
      motion: "smooth",
      saveParseHistory: true,
      showDownloadOptionsDialog: true,
      preallocateFileSpace: true,
      monitorClipboard: false,
      autoSelectMode: "conditional",
      autoSelectConditions: { userUploads: 0, bangumi: 0, other: 0 },
      showAutoParseDialog: false,
      autoParseInterval: 2,
      autoAddToDownloadList: false,
    },
    advanced: {
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
      userAgent: DEFAULT_USER_AGENT,
      mcpEnabled: false,
      mcpPort: 23330,
      mcpToken: "",
      mcpBindAddress: "127.0.0.1",
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
  /** 优先级数组：必须是**非空**的数字数组，且去重保序；否则整体回退默认（半截数组比默认更糟） */
  const priority = (v: unknown, fallback: number[]): number[] => {
    if (!Array.isArray(v) || v.length === 0) return [...fallback];
    const seen = new Set<number>();
    const out: number[] = [];
    for (const item of v) {
      if (typeof item !== "number" || !Number.isFinite(item)) return [...fallback];
      const n = Math.floor(item);
      if (seen.has(n)) continue;
      seen.add(n);
      out.push(n);
    }
    return out.length ? out : [...fallback];
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
    deliver: isOneOf(o.deliver, DELIVER_MODES) ? o.deliver : def.deliver,
    m4aToMp3: typeof o.m4aToMp3 === "boolean" ? o.m4aToMp3 : def.m4aToMp3,
    videoQualityPriority: priority(o.videoQualityPriority, def.videoQualityPriority),
    audioQualityPriority: priority(o.audioQualityPriority, def.audioQualityPriority),
    videoCodecPriority: priority(o.videoCodecPriority, def.videoCodecPriority),
  };
}

function sanitizeAutoSelectConditions(raw: unknown, def: AutoSelectConditions): AutoSelectConditions {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const pick = (v: unknown, fallback: 0 | 1): 0 | 1 => (v === 0 || v === 1 ? v : fallback);
  return {
    userUploads: pick(o.userUploads, def.userUploads),
    bangumi: pick(o.bangumi, def.bangumi),
    other: pick(o.other, def.other),
  };
}

function sanitizeBehavior(raw: unknown): BehaviorConfig {
  const def = defaultAppConfig().behavior;
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    language: isOneOf(o.language, LANGUAGES) ? o.language : def.language,
    theme: isOneOf(o.theme, THEMES) ? o.theme : def.theme,
    motion: isOneOf(o.motion, MOTIONS) ? o.motion : def.motion,
    saveParseHistory: typeof o.saveParseHistory === "boolean" ? o.saveParseHistory : def.saveParseHistory,
    showDownloadOptionsDialog:
      typeof o.showDownloadOptionsDialog === "boolean" ? o.showDownloadOptionsDialog : def.showDownloadOptionsDialog,
    preallocateFileSpace:
      typeof o.preallocateFileSpace === "boolean" ? o.preallocateFileSpace : def.preallocateFileSpace,
    monitorClipboard: typeof o.monitorClipboard === "boolean" ? o.monitorClipboard : def.monitorClipboard,
    autoSelectMode: isOneOf(o.autoSelectMode, AUTO_SELECT_MODES) ? o.autoSelectMode : def.autoSelectMode,
    autoSelectConditions: sanitizeAutoSelectConditions(o.autoSelectConditions, def.autoSelectConditions),
    showAutoParseDialog:
      typeof o.showAutoParseDialog === "boolean" ? o.showAutoParseDialog : def.showAutoParseDialog,
    // 解析间隔：桌面 DoubleSpinBox 的范围就是 0.1–15.0（`auto_parse.py:54`），越界夹紧
    autoParseInterval:
      typeof o.autoParseInterval === "number" && Number.isFinite(o.autoParseInterval)
        ? Math.min(15, Math.max(0.1, o.autoParseInterval))
        : def.autoParseInterval,
    autoAddToDownloadList:
      typeof o.autoAddToDownloadList === "boolean" ? o.autoAddToDownloadList : def.autoAddToDownloadList,
  };
}

function sanitizeAdvanced(raw: unknown): AdvancedConfig {
  const def = defaultAppConfig().advanced;
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const strList = (v: unknown, fallback: string[]): string[] =>
    Array.isArray(v) ? (v as unknown[]).filter((s): s is string => typeof s === "string") : fallback;
  const out: AdvancedConfig = {
    cnCdnHosts: strList(o.cnCdnHosts, def.cnCdnHosts),
    ovCdnHosts: strList(o.ovCdnHosts, def.ovCdnHosts),
    preferCdnServerProvider:
      typeof o.preferCdnServerProvider === "boolean" ? o.preferCdnServerProvider : def.preferCdnServerProvider,
    area: isOneOf(o.area, AREAS) ? o.area : def.area,
    proxyMode: isOneOf(o.proxyMode, PROXY_MODES) ? o.proxyMode : def.proxyMode,
    proxyType: isOneOf(o.proxyType, PROXY_TYPES) ? o.proxyType : def.proxyType,
    proxyServer: typeof o.proxyServer === "string" ? o.proxyServer : def.proxyServer,
    // 端口 1..65535（越界回默认 80，而不是留着让 URL 拼出个非法端口）
    proxyPort: Number.isInteger(o.proxyPort) && (o.proxyPort as number) >= 1 && (o.proxyPort as number) <= 65535
      ? (o.proxyPort as number)
      : def.proxyPort,
    proxyUname: typeof o.proxyUname === "string" ? o.proxyUname : def.proxyUname,
    proxyPassword: typeof o.proxyPassword === "string" ? o.proxyPassword : def.proxyPassword,
    userAgent: typeof o.userAgent === "string" && o.userAgent.trim() !== "" ? o.userAgent : def.userAgent,
    mcpEnabled: typeof o.mcpEnabled === "boolean" ? o.mcpEnabled : def.mcpEnabled,
    mcpPort: Number.isInteger(o.mcpPort) && (o.mcpPort as number) >= 1024 && (o.mcpPort as number) <= 65535
      ? (o.mcpPort as number)
      : def.mcpPort,
    mcpToken: typeof o.mcpToken === "string" ? o.mcpToken : def.mcpToken,
    // 只允许回环或"所有网卡"两种；别的一律回默认，避免写个奇怪的地址导致监听失败
    mcpBindAddress: o.mcpBindAddress === "0.0.0.0" ? "0.0.0.0" : "127.0.0.1",
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
  if (!isOneOf(dl.deliver, DELIVER_MODES)) errors.push("download.deliver 需为 server 或 local");
  if (!isOneOf(dl.duplicatePolicy, DUPLICATE_POLICIES)) {
    errors.push("download.duplicatePolicy 需为 prompt、skip 或 force");
  }
  if (!isOneOf(dl.defaultContainer, CONTAINERS)) errors.push("download.defaultContainer 需为 mp4 或 mkv");
  if (typeof dl.m4aToMp3 !== "boolean") errors.push("download.m4aToMp3 需为布尔值");
  // 三个优先级数组：必须是非空的数字数组（空数组会让引擎的自动选择无从下手）
  for (const [field, arr] of [
    ["download.videoQualityPriority", dl.videoQualityPriority],
    ["download.audioQualityPriority", dl.audioQualityPriority],
    ["download.videoCodecPriority", dl.videoCodecPriority],
  ] as const) {
    if (!Array.isArray(arr) || arr.length === 0 || arr.some((n) => typeof n !== "number" || !Number.isFinite(n))) {
      errors.push(`${field} 需为非空的数字数组`);
    }
  }
  if (!isOneOf(be.language, LANGUAGES)) errors.push("behavior.language 需为 zh-CN、zh-TW、en 或 system");
  if (typeof be.preallocateFileSpace !== "boolean") errors.push("behavior.preallocateFileSpace 需为布尔值");
  if (typeof be.monitorClipboard !== "boolean") errors.push("behavior.monitorClipboard 需为布尔值");
  if (!isOneOf(be.theme, THEMES)) errors.push("behavior.theme 需为 light、dark 或 system");
  if (!isOneOf(be.motion, MOTIONS)) errors.push("behavior.motion 需为 smooth 或 reduced");
  if (typeof be.saveParseHistory !== "boolean") errors.push("behavior.saveParseHistory 需为布尔值");
  if (typeof be.showDownloadOptionsDialog !== "boolean") errors.push("behavior.showDownloadOptionsDialog 需为布尔值");
  if (typeof be.showAutoParseDialog !== "boolean") errors.push("behavior.showAutoParseDialog 需为布尔值");
  if (typeof be.autoAddToDownloadList !== "boolean") errors.push("behavior.autoAddToDownloadList 需为布尔值");
  if (typeof be.autoParseInterval !== "number" || !Number.isFinite(be.autoParseInterval) || be.autoParseInterval < 0.1 || be.autoParseInterval > 15) {
    errors.push("behavior.autoParseInterval 需为 0.1 到 15 之间的数字");
  }
  if (!isOneOf(be.autoSelectMode, AUTO_SELECT_MODES)) {
    errors.push("behavior.autoSelectMode 需为 manual、all 或 conditional");
  }
  for (const key of ["userUploads", "bangumi", "other"] as const) {
    const v = be.autoSelectConditions?.[key];
    if (v !== 0 && v !== 1) errors.push(`behavior.autoSelectConditions.${key} 需为 0 或 1`);
  }
  const nonNegative = (field: string, v: number | undefined): void => {
    if (v !== undefined && (typeof v !== "number" || !Number.isFinite(v) || v < 0)) {
      errors.push(`${field} 需为不小于 0 的数字`);
    }
  };
  nonNegative("advanced.defaultVideoQualityId", ad.defaultVideoQualityId);
  nonNegative("advanced.defaultAudioQualityId", ad.defaultAudioQualityId);
  nonNegative("advanced.defaultCodecId", ad.defaultCodecId);
  if (!Array.isArray(ad.cnCdnHosts) || ad.cnCdnHosts.some((s) => typeof s !== "string")) {
    errors.push("advanced.cnCdnHosts 需为字符串数组");
  }
  if (!Array.isArray(ad.ovCdnHosts) || ad.ovCdnHosts.some((s) => typeof s !== "string")) {
    errors.push("advanced.ovCdnHosts 需为字符串数组");
  }
  if (ad.ffmpegPath !== undefined && typeof ad.ffmpegPath !== "string") {
    errors.push("advanced.ffmpegPath 需为字符串");
  }
  if (!isOneOf(ad.proxyMode, PROXY_MODES)) {
    errors.push("advanced.proxyMode 需为 disabled、system 或 manual");
  }
  if (!isOneOf(ad.proxyType, PROXY_TYPES)) errors.push("advanced.proxyType 需为 http");
  if (typeof ad.proxyServer !== "string") errors.push("advanced.proxyServer 需为字符串");
  if (!Number.isInteger(ad.proxyPort) || ad.proxyPort < 1 || ad.proxyPort > 65535) {
    errors.push("advanced.proxyPort 需为 1..65535 的整数");
  }
  if (typeof ad.proxyUname !== "string") errors.push("advanced.proxyUname 需为字符串");
  if (typeof ad.proxyPassword !== "string") errors.push("advanced.proxyPassword 需为字符串");
  if (!isOneOf(ad.area, AREAS)) errors.push("advanced.area 需为 cn 或 ov");
  if (typeof ad.preferCdnServerProvider !== "boolean") {
    errors.push("advanced.preferCdnServerProvider 需为布尔值");
  }
  // UA 不能为空：原版 UserAgentDialog 也会拦「User-Agent 不能为空」
  if (typeof ad.userAgent !== "string" || ad.userAgent.trim() === "") {
    errors.push("advanced.userAgent 不能为空");
  }
  // 手动代理必须填地址，否则等于开了个空代理（原版是"测试"按钮才发现，我们这里直接拦）
  if (ad.proxyMode === "manual" && ad.proxyServer.trim() === "") {
    errors.push("advanced.proxyMode 为 manual 时必须填写代理服务器地址");
  }
  if (typeof ad.mcpEnabled !== "boolean") errors.push("advanced.mcpEnabled 需为布尔值");
  if (!Number.isInteger(ad.mcpPort) || ad.mcpPort < 1024 || ad.mcpPort > 65535) {
    errors.push("advanced.mcpPort 需为 1024..65535 的整数");
  }
  if (typeof ad.mcpToken !== "string") errors.push("advanced.mcpToken 需为字符串");
  if (ad.mcpEnabled && ad.mcpToken.trim() === "") {
    // 开通了却没有令牌 = 任何能连到端口的人都能建下载任务，直接拦。
    // 消息里带上字段名：读 400 的人要能一眼知道改哪个键。
    errors.push("advanced.mcpToken 不能为空（启用 MCP 服务器前必须先生成访问令牌）");
  }
  if (ad.mcpBindAddress !== "127.0.0.1" && ad.mcpBindAddress !== "0.0.0.0") {
    errors.push("advanced.mcpBindAddress 只能是 127.0.0.1 或 0.0.0.0");
  }
  return errors;
}

/** 生成 MCP 访问令牌（原版用 `secrets.token_urlsafe(32)`，这里用等价的 32 字节随机） */
export function generateMcpToken(): string {
  // base64url 去掉填充，长度与 Python 的 token_urlsafe(32) 同量级（43 字符）
  return randomBytes(32).toString("base64url");
}

/** 按当前配置算出实际要用的代理 URL；不启用/无地址时返回 undefined（引擎据此直连） */
export function resolveProxyUrl(ad: AdvancedConfig): string | undefined {
  if (ad.proxyMode !== "manual" || ad.proxyServer.trim() === "") return undefined;
  const auth = ad.proxyUname
    ? `${encodeURIComponent(ad.proxyUname)}:${encodeURIComponent(ad.proxyPassword)}@`
    : "";
  return `${ad.proxyType}://${auth}${ad.proxyServer.trim()}:${ad.proxyPort}`;
}

/** 按区域与"优先服务商 CDN"开关算出取流时要尝试的 CDN 节点 */
export function resolveCdnHosts(ad: AdvancedConfig): string[] {
  if (!ad.preferCdnServerProvider) return [];
  return ad.area === "ov" ? [...ad.ovCdnHosts] : [...ad.cnCdnHosts];
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

  /**
   * 整体替换配置（**配置导入**，原版「配置文件设置 → 导入」）。
   *
   * 走**同一套净化**（`sanitize*`）：导入一份手改过的 / 别的版本导出的文件时，
   * 非法值回退默认而不是把程序带崩 —— 与读盘路径的行为一致。
   * 净化后仍不通过校验的（如启用 MCP 却没有令牌）直接拒绝，不落盘。
   */
  async replaceAll(raw: unknown): Promise<AppConfig> {
    await this.load();
    const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    const next = defaultAppConfig();
    if (o.additional !== undefined) next.additional = deepMerge(next.additional, o.additional as Record<string, unknown>);
    if (o.fileNaming !== undefined && typeof o.fileNaming === "object") {
      // 与读盘路径同一套宽松处理：规则非空数组才接受，编号模式/起始号逐个校验
      const fn = o.fileNaming as Partial<FileNamingConfig>;
      if (Array.isArray(fn.rules) && fn.rules.length > 0) next.fileNaming.rules = fn.rules as NamingRule[];
      if (fn.numberingType !== undefined) next.fileNaming.numberingType = fn.numberingType;
      if (fn.startingNumber !== undefined && Number.isFinite(fn.startingNumber)) {
        next.fileNaming.startingNumber = Math.max(1, Math.floor(fn.startingNumber));
      }
    }
    if (o.download !== undefined) next.download = sanitizeDownload(o.download);
    if (o.behavior !== undefined) next.behavior = sanitizeBehavior(o.behavior);
    if (o.advanced !== undefined) next.advanced = sanitizeAdvanced(o.advanced);
    const errors = validateConfig(next);
    if (errors.length) throw new Error(errors.join("；"));
    this.#config = next;
    await this.#persist(next);
    return next;
  }

  /** 重置为默认配置（原版「配置文件设置 → 重置」） */
  async resetAll(): Promise<AppConfig> {
    await this.load();
    const next = defaultAppConfig();
    this.#config = next;
    await this.#persist(next);
    return next;
  }

  /** 导出当前配置（就是落盘的那份 JSON 对象） */
  async exportAll(): Promise<AppConfig> {
    await this.load();
    return this.#config;
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
