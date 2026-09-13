import { useEffect, useState } from "react";
import { fileThumbUrl, getSystemInfo, listDirs } from "../services/client";
import { t as tr } from "../lib/i18n";
import { Overlay } from "./Overlay";

/**
 * 服务端目录浏览弹窗 —— 原版各处 `Directory.browse_directory()` 的 Web 对应物。
 *
 * 设置页「下载目录」与下载选项弹窗「下载目录卡」共用同一个组件
 * （原版两处也都是 `DownloadPathSettingCard` 内嵌 `Directory.browse_directory`）。
 */
/** 路径是否相同（忽略结尾分隔符与大小写——Windows 不区分） */
function samePath(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase();
  return norm(a) === norm(b);
}
/** 是否落在允许范围内（roots 为空=未限制）。与服务端 isPathAllowed 同语义 */
function inScopeOf(roots: string[], p: string): boolean {
  if (roots.length === 0) return true;
  const norm = (v: string) => v.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const target = norm(p);
  return roots.some((r) => { const root = norm(r); return target === root || target.startsWith(root + "/"); });
}

export function DirPicker({ open, onClose, value, onPick }: { open: boolean; onClose: () => void; value: string; onPick: (dir: string) => void }) {
  const [current, setCurrent] = useState<string>(value || "/");
  const [dirs, setDirs] = useState<Array<{ name: string; path: string; cover?: string }>>([]);
  /** 当前目录里的图片文件（显示成缩略图，便于"看图找目录"） */
  const [images, setImages] = useState<Array<{ name: string; path: string; size: number; thumb: boolean }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [manual, setManual] = useState(value || "");
  /** 当前浏览目录超出允许范围时为它的路径（用来显示说明而不是红字报错） */
  const [outOfScope, setOutOfScope] = useState<string | null>(null);
  const inScope = (p: string): boolean => inScopeOf(host?.allowedRoots ?? [], p);
  /** 服务器信息：**必须**让用户知道这是哪台机器上的目录（否则会以为选错了） */
  const [host, setHost] = useState<{ host: string; localhost: boolean; allowedRoots: string[] } | null>(null);

  useEffect(() => {
    if (!open) return;
    // 没给起始目录时别用 "/"：Windows 下那不是根，列出来一堆空。
    // 先问服务端要"下载目录 / 数据目录 / 盘符"，用它作为起点。
    let cancelled = false;
    void getSystemInfo().then((r) => {
      if (cancelled) return;
      const roots = r.allowedRoots ?? [];
      setHost({ host: r.host, localhost: r.localhost, allowedRoots: roots });
      /**
       * 起始目录：当前值 → 下载目录 → 范围第一项。
       * ⚠️ 当前值也要**先验证在范围内**：配置里可能存着一个旧的范围外路径（例如限制之前设的），
       * 直接用它开屏就会撞 403（用户看到的就是「读取失败：该目录超出允许的存储范围…」）。
       */
      const candidates = [value, r.downloadDir, roots[0]];
      const start = candidates.find((c) => c && inScopeOf(roots, c)) ?? roots[0] ?? value ?? "/";
      setCurrent(start);
      setManual(value || "");
      setError("");
    }).catch(() => {
      setCurrent(value || "/");
      setManual(value || "");
    });
    return () => { cancelled = true; };
  }, [open, value]);

  useEffect(() => {
    if (!open || !current) return;
    /**
     * 范围外的目录**根本不发请求**：服务端会回 403，前端只能显示一条红字错误，
     * 用户看到的就是「读取失败：该目录超出允许的存储范围…」。
     * 这里提前判断，给一段说明 + 范围入口，比报错友好得多。
     */
    if (!inScope(current)) {
      setDirs([]);
      setImages([]);
      setError("");
      setOutOfScope(current);
      setLoading(false);
      return;
    }
    setOutOfScope(null);
    setLoading(true);
    setError("");
    listDirs(current)
      .then((r) => { setDirs(r.dirs); setImages(r.images ?? []); })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [open, current]);

  /**
   * 上级目录。⚠️ 原来只用 "/" 找分隔符 —— Windows 路径全是反斜杠，
   * 于是一路"往上"其实直接跳回盘根（`C:\`），看着像不能往上走。
   * 另外盘根（`C:\`）与 UNC 根（`\\server\share`）都不该再往上。
   */
  /** 已经在根上（盘根 C:\ / POSIX 根 / UNC 根）或已到**允许范围**的边界，就不能再往上了 */
  const atRoot = (p: string): boolean => {
    const t = p.replace(/[\\/]+$/, "");
    if (/^[A-Za-z]:$/.test(t) || t === "" || t === "/" || /^\\\\[^\\]+\\[^\\]+$/.test(t)) return true;
    // 范围边界：站在 /volume1 或 /data 上时，再往上就是 /（范围外）
    return (host?.allowedRoots ?? []).some((r) => samePath(t, r));
  };
  const up = () => {
    const trimmed = current.replace(/[\\/]+$/, "");
    if (/^[A-Za-z]:$/.test(trimmed)) return;                       // C: → 已到盘根
    const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
    const parent = idx > 2 ? trimmed.slice(0, idx)
      : (/^[A-Za-z]:/.test(trimmed) ? trimmed.slice(0, 2) + "\\" : "/");
    // 父目录在范围外（例如 /data → /）就不动，别让用户撞 403
    if (!inScope(parent)) return;
    setCurrent(parent);
    setManual(parent);
  };
  const enter = (path: string) => { setCurrent(path); setManual(path); };
  /**
   * 确认选择。⚠️ 先**就地校验范围**：手动输入的路径可能在范围外，
   * 以前会直接提交给服务端 → 400 → 用户只看到一条 toast/什么都没发生。
   * 现在停在弹窗里、把说明块亮出来（还给出可选的根目录），用户能立刻改。
   */
  const confirmPick = () => {
    const dir = manual.trim().replace(/[\\/]+$/, "") || "/";
    if (!inScope(dir)) { setCurrent(dir); setManual(dir); return; }
    onPick(dir);
    onClose();
  };

  return (
    <Overlay open={open} onClose={onClose} size="md" sheetOnMobile centerOnMobile>
        <div className="modal-head">
          <div className="modal-title">{tr("选择下载目录")}</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={tr("关闭")}>
            <svg className="ico" viewBox="0 0 24 24" width={18} height={18}><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="modal-body">
          {/* 这是哪台机器上的目录 —— 用户选「NAS 模式」却看到 C:\ 会以为选错了，必须直说 */}
          {host && (
            <p className="small muted" style={{ marginBottom: 6 }}>
              {tr("这里浏览的是运行服务的那台机器（{host}）上的目录").replace("{host}", host.host)}
              {host.localhost ? tr("—— 服务就跑在这台电脑上，所以看到的是本机路径") : ""}
            </p>
          )}
          {/* 存储范围（部署级配置）：说清"只能在这些目录里选"，否则用户会以为是坏了；
              并且把范围做成可点的入口 —— 否则从范围里"往上"就出不去了 */}
          {host && host.allowedRoots.length > 0 && (
            <p className="small muted" style={{ marginBottom: 6 }}>
              {tr("允许的存储范围：{roots}（其它路径不可选）").replace("{roots}", host.allowedRoots.join("、"))}
            </p>
          )}
          {host && host.allowedRoots.length > 1 && (
            <div className="dir-quick">
              {host.allowedRoots.map((r) => (
                <button key={r} type="button" className="btn sm ghost" title={r} onClick={() => enter(r)}
                  disabled={samePath(current, r)}>
                  {r}
                </button>
              ))}
            </div>
          )}

          <div className="dir-picker-current">
            <button type="button" className="btn sm ghost" onClick={up} disabled={atRoot(current)}>↑ 上级</button>
            <code className="dir-current-path">{current}</code>
          </div>
          <div className="dir-picker-list">
            {loading && <p className="muted small">{tr("加载中…")}</p>}
            {error && <p className="danger small">读取失败：{error}</p>}
            {/* 超出范围：给说明 + 回到范围内的入口，而不是一条红字报错 */}
            {outOfScope && (
              <div className="dir-out-of-scope">
                <p className="small">{tr("这个目录不在允许的存储范围里，不能浏览或选用：")}</p>
                <code className="dir-current-path">{outOfScope}</code>
                {(host?.allowedRoots ?? []).length > 0 && (
                  <p className="small muted" style={{ marginTop: 6 }}>
                    {tr("可选的根目录：")}
                    {(host?.allowedRoots ?? []).map((r) => (
                      <button key={r} type="button" className="btn sm ghost" style={{ marginLeft: 6 }} onClick={() => enter(r)}>{r}</button>
                    ))}
                  </p>
                )}
              </div>
            )}
            {!loading && !error && !outOfScope && dirs.length === 0 && <p className="muted small">{tr("此目录没有可选的子目录")}</p>}
            {!outOfScope && dirs.map((d) => (
              <button key={d.path} type="button" className="dir-row" onClick={() => enter(d.path)}>
                {/* 该目录里第一张图当封面 —— 下载产物会把封面与视频放同一目录，
                    于是"看图找目录"就成立了（用户要的资源管理器效果） */}
                {d.cover
                  ? <img className="dir-thumb" src={fileThumbUrl(d.cover)} alt="" loading="lazy" decoding="async"
                      onError={(e) => { e.currentTarget.style.display = "none"; }} />
                  : <span className="dir-thumb placeholder"><svg className="ico" viewBox="0 0 24 24" width={16} height={16}><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z" /></svg></span>}
                <span className="dir-row-name">{d.name}</span>
              </button>
            ))}
            {/* 当前目录里的图片：缩略图墙 */}
            {!outOfScope && images.length > 0 && (
              <div className="dir-images">
                <div className="small muted" style={{ margin: "10px 0 6px" }}>{tr("这个目录里的图片：")}</div>
                <div className="dir-image-grid">
                  {images.map((img) => (
                    <figure key={img.path} className="dir-image" title={`${img.name}（${Math.round(img.size / 1024)} KB）`}>
                      {img.thumb
                        ? <img src={fileThumbUrl(img.path)} alt={img.name} loading="lazy" decoding="async"
                            onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
                        : <span className="dir-image-big"><svg className="ico" viewBox="0 0 24 24" width={18} height={18}><path d="M4 5h16v14H4z" /><path d="M4 15l4-4 4 4 3-3 5 5" /></svg></span>}
                      <figcaption>{img.name}</figcaption>
                    </figure>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="dir-picker-tip"><span className="small muted">{tr("点击目录进入子目录，路径会同步到底部输入框；也可以直接在下面输入网络路径。")}</span></div>
        </div>
        <div className="modal-foot">
          <div className="dir-picker-manual">
            <input className="text-input" style={{ flex: 1 }} value={manual} onChange={(e) => setManual(e.target.value)} placeholder={tr("或直接输入路径：NAS 网络共享 \\\\NAS\\media、映射盘 Z:\\\\media、容器内路径…")} />
          </div>
          <div className="right">
            <button type="button" className="btn" onClick={onClose}>{tr("取消")}</button>
            <button type="button" className="btn primary" onClick={confirmPick}>{tr("使用此目录")}</button>
          </div>
        </div>
      </Overlay>
  );
}
