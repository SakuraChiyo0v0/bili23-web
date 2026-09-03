import { DATETIME_VARIABLES } from "./variables.js";
import type { NamingVariables } from "./context.js";

/**
 * 命名模板求值（对齐桌面 FileNameFormatter + util/format/time.py）：
 * - 支持 Python str.format 子集：`{name}`、`{name:02d}`（数字补零）、时间变量 `{name:%Y-%m-%d...}`（strftime 子集）
 * - 未知变量名抛错（设置页据此做模板校验）
 * - 逐路径段清洗非法字符并按多级目录归一化
 */

const TOKEN = /\{(\w+)(?::([^}]*))?\}/g;

/** strftime 子集（覆盖桌面默认模板用到的记号） */
export function strftime(format: string, date: Date): string {
  const pad = (n: number, w = 2): string => String(n).padStart(w, "0");
  const map: Record<string, string> = {
    "%Y": String(date.getFullYear()),
    "%y": pad(date.getFullYear() % 100),
    "%m": pad(date.getMonth() + 1),
    "%d": pad(date.getDate()),
    "%H": pad(date.getHours()),
    "%M": pad(date.getMinutes()),
    "%S": pad(date.getSeconds()),
    "%b": ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getMonth()] ?? "",
    "%B": ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][date.getMonth()] ?? "",
    "%%": "%",
  };
  // 先把 %% 保护起来，再替换其余记号
  let out = format.replace(/%%/g, "\u0000");
  for (const [token, value] of Object.entries(map)) {
    if (token === "%%") continue;
    out = out.split(token).join(value);
  }
  return out.split("\u0000").join("%");
}

/** 非法文件名字符（对齐桌面 re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", ...)） */
const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f]/g;

export function sanitizeComponent(value: string): string {
  return value.replace(ILLEGAL, "_");
}

/** 将单个值渲染成模板片段（含清洗与 format spec） */
export function renderValue(name: string, raw: string | number, spec?: string): string {
  if (spec && DATETIME_VARIABLES.has(name) && spec.includes("%")) {
    const ts = typeof raw === "number" ? raw : Number(raw);
    const date = new Date((Number.isFinite(ts) && ts > 0 ? ts : 0) * 1000);
    return sanitizeComponent(strftime(spec, date));
  }
  let text = String(raw);
  if (spec) {
    const m = /^0(\d+)d?$/.exec(spec.trim());
    if (m) {
      const width = Number(m[1]);
      const numeric = Number(text);
      if (Number.isFinite(numeric)) text = String(Math.trunc(numeric)).padStart(width, "0");
      else text = text.padStart(width, "0");
    }
  }
  return sanitizeComponent(text);
}

/** 路径归一化：去首尾斜杠/空白/点、丢弃空段（对齐桌面 __normalize_path；空结果返回 "_"） */
export function normalizePath(pathStr: string): string {
  const cleaned = pathStr.replace(/^[/\\]+/, "").trim();
  if (!cleaned) return "_";
  const parts = cleaned
    .split(/[/\\]+/)
    .map((p) => p.replace(/^[/\\]+/, "").replace(/^[.\s]+|[.\s]+$/g, ""))
    .filter((p) => p.length > 0);
  if (parts.length === 0) return "_";
  return parts.join("/");
}

/** 校验模板：引用的变量必须全部已知，且括号配平 */
export function validateRule(rule: string, known: ReadonlySet<string>): string[] {
  const errors: string[] = [];
  for (const m of rule.matchAll(TOKEN)) {
    const name = m[1] ?? "";
    if (!known.has(name)) errors.push(`未知变量 {${name}}`);
  }
  return errors;
}

/**
 * 格式化文件名/相对路径。
 * @param rule 模板（可含 "/"）
 * @param vars 变量表（buildNamingVariables 产出）
 * @returns 相对路径字符串（不含扩展名），失败（未知变量/格式错）抛错
 */
export function formatFileName(rule: string, vars: NamingVariables): string {
  const rendered = rule.replace(TOKEN, (_all, name: string, spec?: string) => {
    if (!(name in vars)) {
      throw new Error(`命名模板引用了未知变量 {${name}}`);
    }
    return renderValue(name, vars[name] as string | number, spec);
  });
  return normalizePath(rendered);
}

