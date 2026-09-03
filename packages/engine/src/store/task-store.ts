import { DatabaseSync } from "node:sqlite";
import { HASH_ID_VERSION } from "./hash.js";

/**
 * 下载任务持久化（SQLite，node:sqlite）。
 * 表结构与桌面 download/task/db.py 对齐：download_task（进行中）+ completed_task（已完成），
 * 各列 task_id / hash_id / cover_id / title / 时间戳 / data(完整任务快照 JSON)。
 * data 由上层快照（含分片断点）序列化，支持进程重启后恢复下载。
 */

export interface TaskRecord {
  taskId: string;
  hashId: string;
  /** 封面缓存标识（对齐桌面 cover_id，P1 可为空串） */
  coverId: string;
  title: string;
  /** Unix 秒 */
  time: number;
  /** 完整任务快照（反序列化后的 JSON data） */
  data: unknown;
}

export interface TaskStoreOptions {
  /** data 列是否以 JSON 字符串读写（默认 true） */
  json?: boolean;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS download_task (
  task_id      TEXT PRIMARY KEY,
  hash_id      TEXT NOT NULL,
  cover_id     TEXT NOT NULL DEFAULT '',
  title        TEXT NOT NULL DEFAULT '',
  created_time INTEGER NOT NULL,
  data         TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS completed_task (
  task_id        TEXT PRIMARY KEY,
  hash_id        TEXT NOT NULL,
  cover_id       TEXT NOT NULL DEFAULT '',
  title          TEXT NOT NULL DEFAULT '',
  completed_time INTEGER NOT NULL,
  data           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_download_task_hash_id ON download_task (hash_id);
CREATE INDEX IF NOT EXISTS idx_completed_task_hash_id ON completed_task (hash_id);
CREATE INDEX IF NOT EXISTS idx_download_task_created_time ON download_task (created_time);
CREATE INDEX IF NOT EXISTS idx_completed_task_completed_time ON completed_task (completed_time);
`;

export class TaskStore {
  readonly #db: DatabaseSync;

  constructor(dbPath: string) {
    this.#db = new DatabaseSync(dbPath);
    this.#db.exec("PRAGMA journal_mode = WAL;");
    this.#db.exec(SCHEMA);
    this.#db.exec(`PRAGMA user_version = ${HASH_ID_VERSION};`);
  }

  close(): void {
    this.#db.close();
  }

  /** hash 是否已存在于进行中或已完成任务（重复下载判定，对齐桌面 db_manager.check_duplicate） */
  checkDuplicate(hashId: string): boolean {
    const row = this.#db
      .prepare("SELECT 1 FROM download_task WHERE hash_id = ? UNION ALL SELECT 1 FROM completed_task WHERE hash_id = ? LIMIT 1")
      .get(hashId, hashId);
    return row !== undefined;
  }

  // ---- 进行中任务（download_task） ----

  upsertActive(record: { taskId: string; hashId: string; title?: string; coverId?: string; time?: number; data: unknown }): void {
    const time = record.time ?? Math.floor(Date.now() / 1000);
    this.#db
      .prepare(
        `INSERT INTO download_task (task_id, hash_id, cover_id, title, created_time, data)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(task_id) DO UPDATE SET
           hash_id = excluded.hash_id,
           cover_id = excluded.cover_id,
           title = excluded.title,
           data = excluded.data`,
      )
      .run(record.taskId, record.hashId, record.coverId ?? "", record.title ?? "", time, JSON.stringify(record.data));
  }

  updateActiveData(taskId: string, data: unknown): void {
    this.#db.prepare("UPDATE download_task SET data = ? WHERE task_id = ?").run(JSON.stringify(data), taskId);
  }

  getActive(taskId: string): TaskRecord | null {
    const row = this.#db
      .prepare("SELECT task_id, hash_id, cover_id, title, created_time, data FROM download_task WHERE task_id = ?")
      .get(taskId) as
      | { task_id: string; hash_id: string; cover_id: string; title: string; created_time: number; data: string }
      | undefined;
    return row ? mapRow(row) : null;
  }

  listActive(): TaskRecord[] {
    const rows = this.#db
      .prepare("SELECT task_id, hash_id, cover_id, title, created_time, data FROM download_task ORDER BY created_time ASC")
      .all() as Array<{ task_id: string; hash_id: string; cover_id: string; title: string; created_time: number; data: string }>;
    return rows.map(mapRow);
  }

  removeActive(taskId: string): void {
    this.#db.prepare("DELETE FROM download_task WHERE task_id = ?").run(taskId);
  }

  // ---- 已完成任务（completed_task，历史） ----

  addCompleted(record: { taskId: string; hashId: string; title?: string; coverId?: string; time?: number; data: unknown }): void {
    const time = record.time ?? Math.floor(Date.now() / 1000);
    this.#db
      .prepare(
        `INSERT INTO completed_task (task_id, hash_id, cover_id, title, completed_time, data)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(task_id) DO UPDATE SET
           hash_id = excluded.hash_id,
           cover_id = excluded.cover_id,
           title = excluded.title,
           completed_time = excluded.completed_time,
           data = excluded.data`,
      )
      .run(record.taskId, record.hashId, record.coverId ?? "", record.title ?? "", time, JSON.stringify(record.data));
  }

  getCompleted(taskId: string): TaskRecord | null {
    const row = this.#db
      .prepare("SELECT task_id, hash_id, cover_id, title, completed_time, data FROM completed_task WHERE task_id = ?")
      .get(taskId) as
      | { task_id: string; hash_id: string; cover_id: string; title: string; completed_time: number; data: string }
      | undefined;
    return row ? mapRow(row) : null;
  }

  /** 已完成历史，按时间倒序；limit 缺省返回全部 */
  listCompleted(limit?: number): TaskRecord[] {
    const sql =
      limit === undefined
        ? "SELECT task_id, hash_id, cover_id, title, completed_time, data FROM completed_task ORDER BY completed_time DESC"
        : "SELECT task_id, hash_id, cover_id, title, completed_time, data FROM completed_task ORDER BY completed_time DESC LIMIT ?";
    const rows = (limit === undefined
      ? this.#db.prepare(sql).all()
      : this.#db.prepare(sql).all(limit)) as Array<{
      task_id: string;
      hash_id: string;
      cover_id: string;
      title: string;
      completed_time: number;
      data: string;
    }>;
    return rows.map(mapRow);
  }

  /** 统计任务数 */
  countActive(): number {
    const row = this.#db.prepare("SELECT COUNT(*) AS n FROM download_task").get() as { n: number };
    return row.n;
  }
}

function mapRow(row: {
  task_id: string;
  hash_id: string;
  cover_id: string;
  title: string;
  created_time?: number;
  completed_time?: number;
  data: string;
}): TaskRecord {
  return {
    taskId: row.task_id,
    hashId: row.hash_id,
    coverId: row.cover_id,
    title: row.title,
    time: row.completed_time ?? row.created_time ?? 0,
    data: JSON.parse(row.data),
  };
}

