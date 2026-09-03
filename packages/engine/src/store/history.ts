import type { TaskStore, TaskRecord } from "./task-store.js";
import { calcHashId } from "./hash.js";
import type { HashIdentity } from "./hash.js";

/**
 * 下载历史/去重查询（对齐桌面 task/manager.py 的重复下载判定与历史列表语义）。
 * 历史 = completed_task 表；重复判定同时覆盖进行中与已完成任务。
 */

export interface HistoryEntry {
  taskId: string;
  hashId: string;
  title: string;
  /** 完成时间（Unix 秒） */
  completedAt: number;
  /** 完整快照 */
  data: unknown;
}

export function toHistoryEntry(record: TaskRecord): HistoryEntry {
  return {
    taskId: record.taskId,
    hashId: record.hashId,
    title: record.title,
    completedAt: record.time,
    data: record.data,
  };
}

export class HistoryService {
  readonly #store: TaskStore;

  constructor(store: TaskStore) {
    this.#store = store;
  }

  /** 依据媒体身份计算 hash_id（供重复判定/入库） */
  hashOf(identity: HashIdentity): string {
    return calcHashId(identity);
  }

  /** 是否重复：同一视频已在下载中或历史里（对齐桌面 db_manager.check_duplicate） */
  isDuplicate(hashId: string): boolean {
    return this.#store.checkDuplicate(hashId);
  }

  /** 最近 N 条已完成历史（倒序） */
  listRecent(limit?: number): HistoryEntry[] {
    return this.#store.listCompleted(limit).map(toHistoryEntry);
  }
}
