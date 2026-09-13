/**
 * 「本机文件夹」——用 File System Access API 让用户**授权一个本机目录**，之后：
 * 1. 设置页能显示这个目录（只显示名字，见下面的说明）；
 * 2. 「保存到本机」的产物**直接写进这个目录**，不再每次弹「另存为」。
 *
 * ⚠️ 浏览器的硬限制（不是没做）：
 * - **拿不到绝对路径**：`FileSystemDirectoryHandle` 只给 `name`（如 `Videos`），
 *   完整路径 `C:\Users\x\Videos` 属于隐私信息，浏览器不暴露。所以界面上显示的是
 *   「已授权：Videos」+ 一句说明，而不是盘符路径。
 * - **只有桌面 Chrome/Edge 支持**（`showDirectoryPicker`），手机浏览器（含 iOS Safari）都没有，
 *   那边只能走浏览器的默认下载目录 —— 界面会明说。
 * - 句柄可以存进 IndexedDB（结构化克隆），但**权限要重新确认**（`queryPermission`/`requestPermission`）。
 */

type DirHandle = {
  name: string;
  queryPermission?: (d: { mode: "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (d: { mode: "readwrite" }) => Promise<PermissionState>;
  getFileHandle: (name: string, opts?: { create?: boolean }) => Promise<{
    createWritable: () => Promise<{ write: (d: Blob) => Promise<void>; close: () => Promise<void> }>;
  }>;
};

const DB_NAME = "bili23-web";
const STORE = "handles";
const KEY = "localDownloadDir";

/** 当前浏览器是否支持"选本机文件夹"（桌面 Chrome/Edge；手机浏览器基本都不支持） */
export function supportsLocalDir(): boolean {
  return typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
  });
}

async function idbPut(value: unknown): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("idb put failed"));
  });
  db.close();
}

async function idbGet(): Promise<unknown> {
  const db = await openDb();
  const value = await new Promise<unknown>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("idb get failed"));
  });
  db.close();
  return value;
}

async function idbDelete(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  db.close();
}

/** 弹系统对话框让用户选一个本机文件夹（返回目录名；取消返回 null） */
export async function pickLocalDir(): Promise<string | null> {
  const picker = (window as unknown as { showDirectoryPicker?: (o?: { mode?: string }) => Promise<DirHandle> }).showDirectoryPicker;
  if (!picker) return null;
  try {
    const handle = await picker({ mode: "readwrite" });
    await idbPut(handle);
    return handle.name;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return null; // 用户取消
    return null;
  }
}

/** 取已授权的本机目录名（没有则 null）。不主动请求权限，只读缓存 */
export async function getLocalDirName(): Promise<string | null> {
  try {
    const h = (await idbGet()) as DirHandle | undefined;
    return h?.name ?? null;
  } catch {
    return null;
  }
}

/** 清掉已授权的本机目录 */
export async function clearLocalDir(): Promise<void> {
  await idbDelete().catch(() => undefined);
}

/**
 * 把文件写进已授权的本机目录。返回是否成功。
 * 权限可能已被浏览器收回 → 这里会**再请求一次**（用户手势上下文里通常会直接通过）。
 */
export async function writeToLocalDir(fileName: string, blob: Blob): Promise<boolean> {
  try {
    const h = (await idbGet()) as DirHandle | undefined;
    if (!h) return false;
    const opts = { mode: "readwrite" as const };
    let state = (await h.queryPermission?.(opts)) ?? "granted";
    if (state !== "granted") state = (await h.requestPermission?.(opts)) ?? "denied";
    if (state !== "granted") return false;
    const fileHandle = await h.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    return true;
  } catch {
    return false;
  }
}
/**
 * 把一次 fetch 的响应**流式**写进已授权的本机目录（大文件不经过内存）。
 * `FileSystemWritableFileStream` 本身就是 WritableStream，可以直接 `pipeTo`。
 */
export async function writeResponseToLocalDir(fileName: string, res: Response): Promise<boolean> {
  try {
    const h = (await idbGet()) as DirHandle | undefined;
    if (!h || !res.body) return false;
    const opts = { mode: "readwrite" as const };
    let state = (await h.queryPermission?.(opts)) ?? "granted";
    if (state !== "granted") state = (await h.requestPermission?.(opts)) ?? "denied";
    if (state !== "granted") return false;
    const fileHandle = await h.getFileHandle(fileName, { create: true });
    const writable = (await fileHandle.createWritable()) as unknown as WritableStream<Uint8Array>;
    await res.body.pipeTo(writable);
    return true;
  } catch {
    return false;
  }
}

/** 是否已经授权过本机目录（不请求权限，只看缓存） */
export async function hasLocalDir(): Promise<boolean> {
  try {
    return Boolean(await idbGet());
  } catch {
    return false;
  }
}