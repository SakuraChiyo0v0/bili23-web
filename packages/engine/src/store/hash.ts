import { createHash } from "node:crypto";

/**
 * 媒体唯一标识 → hash_id（语义对齐桌面 download/task/hash_id.py）。
 * 解析端与入库端必须使用完全相同的算法，本模块是唯一实现。
 */

/** hash_id 算法版本；算法变化时递增，用于触发数据库已有记录重算 */
export const HASH_ID_VERSION = 1;

export interface HashIdentity {
  /** 内容大类：video（P1）以及后续 bangumi/cheese/lesson/audio 等 */
  type: string;
  aid?: number | null;
  bvid?: string | null;
  cid?: number | null;
  epId?: number | null;
  sid?: number | null;
  courseId?: number | null;
  lessonId?: number | null;
  itemId?: number | null;
  sectionId?: number | null;
  /** 未知/属性缺失时兜底用，保证记录彼此唯一、不会被误判重复 */
  taskId?: string | null;
}

/** 与桌面 _to_int 一致：空值/无法解析 → 0 */
function toInt(value: number | null | undefined): number {
  if (!value) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** 与桌面 _to_str 一致：空值 → "" */
function toStr(value: string | null | undefined): string {
  return value ? String(value) : "";
}

/** 递归按键排序（Python json.dumps sort_keys=True 语义；值本身是标量/对象/数组） */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = sortKeys(obj[key]);
    }
    return sorted;
  }
  return value;
}

/** 稳定 JSON 序列化：sort_keys + 紧凑分隔符（对齐 json_dumps_stable） */
export function stableJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

/**
 * 计算媒体 hash_id。
 * 投稿视频：md5(稳定 JSON { bvid, cid, aid })；
 * 其余类型按桌面 hash_id.py 的分支构造元数据。
 */
export function calcHashId(identity: HashIdentity): string {
  const aid = toInt(identity.aid);
  const cid = toInt(identity.cid);
  const epId = toInt(identity.epId);
  const sid = toInt(identity.sid);
  const bvid = toStr(identity.bvid);
  const taskId = toStr(identity.taskId);
  const courseId = toInt(identity.courseId);
  const lessonId = toInt(identity.lessonId);
  const itemId = toInt(identity.itemId);
  const sectionId = toInt(identity.sectionId);

  let metadata: Record<string, number | string>;
  switch (identity.type) {
    case "video":
      metadata = { bvid, cid, aid };
      break;
    case "bangumi":
      metadata = { bvid, cid, aid, ep_id: epId };
      break;
    case "lesson":
      metadata = { course_id: courseId, lesson_id: lessonId, item_id: itemId, section_id: sectionId };
      break;
    case "cheese":
      metadata = { aid, cid, ep_id: epId };
      break;
    case "audio":
      metadata = { sid };
      break;
    default:
      // 未知类型也要给出可区分的 hash，入库端带上 task_id 避免误判重复
      metadata = { aid, bvid, cid, ep_id: epId, sid, task_id: taskId };
      break;
  }
  return createHash("md5").update(stableJson(metadata), "utf8").digest("hex");
}
