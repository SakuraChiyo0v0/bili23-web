/** 本地持久化（P0 骨架用，均为浏览器端偏好）。后续 P4 改由后端 /api/config 接管。 */
const PREFIX = "bili23.web.";

export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // 隐私模式/容量满时静默失败，不阻塞界面
  }
}

export function clearKey(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    // 忽略
  }
}
