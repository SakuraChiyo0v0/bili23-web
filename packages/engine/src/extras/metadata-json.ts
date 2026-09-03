import type { MetadataInput } from "./types.js";

/**
 * 元数据 JSON 生成。
 * 语义对齐桌面 metadata.py _to_json：序列化条目元数据并按上游规则过滤空值
 * （None/""/[]/{}/0 一律剔除），indent=2。
 * 注：桌面序列化的是内部 Episode dataclass；本引擎以 MetadataInput 归一化结构替代
 * （差异记录于主线程）。
 */

function isEmpty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    value === 0 ||
    (Array.isArray(value) && value.length === 0) ||
    (typeof value === "object" && !Array.isArray(value) && Object.keys(value as object).length === 0)
  );
}

export function buildMetadataJson(input: MetadataInput): string {
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!isEmpty(value)) filtered[key] = value;
  }
  return JSON.stringify(filtered, null, 2);
}
