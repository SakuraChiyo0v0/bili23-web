import { useCallback, useEffect, useState } from "react";
import { listFavorites, listFavFolderCovers, listFollowBangumi, type FavFolder, type FollowBangumi, type Pagination } from "../services/client";
import { Icon, type IconName } from "../lib/icons";
import { pagerRange } from "../lib/pagerRange";
import { useToast } from "../lib/toast";
import { t as tr } from "../lib/i18n";

/**
 * 收藏夹浮层（1:1 原版 `gui/component/widget/flyout.py:FavoriteFlyoutWidget`）。
 *
 * 原版结构（基准图：`docs/ui-preview/ref/FavoriteFlyout-1424x900.png`、`FavoriteFlyout-follow.png`）：
 *   - **左栏没有标题**，直接是 5 项分类；选中项是「浅灰底 + 最左一条强调色竖线」
 *   - **刷新 / 在浏览器中打开两个按钮在左栏底部**（不是内容区右上角）
 *   - 左栏与内容区之间一条细分隔线
 *   - 收藏夹 / 订阅合集 / 追番追剧是**内容分类**；稍后再看 / 历史记录是**动作分类**
 *     （原版 selectable=False，点了直接去解析并关闭浮层）
 *   - 追番：顶部两个**宽下拉**（类型 / 状态）；底部**分页器**（左右箭头 + 页码按钮 +
 *     「共 N 页 / M 个」+ 跳页图标 + 自动解析图标），左对齐
 *   - 空态是居中的一句「暂无内容」
 *
 * 承载形态按 Web 调整（设计稿第 ③ 条允许）：窄屏左栏收成顶部横滑 chip、按钮挪到右上。
 */

/**
 * 封面淡入：图片解码完成才显形（CSS `.loaded`），避免"蹦"地出现。
 * `ref` 里补一次 `complete` 判断 —— 命中缓存时 `onLoad` 可能不触发，否则图会一直透明。
 */
const coverLoaded = (e: React.SyntheticEvent<HTMLImageElement>) => e.currentTarget.classList.add("loaded");
const coverRef = (el: HTMLImageElement | null) => { if (el?.complete) el.classList.add("loaded"); };

type CategoryId = "favorite" | "subscription" | "follow" | "watch_later" | "history";

const CATEGORIES: Array<{ id: CategoryId; label: string; icon: IconName; action?: boolean }> = [
  { id: "favorite", label: "收藏夹", icon: "star" },
  { id: "subscription", label: "订阅合集", icon: "folder" },
  { id: "follow", label: "追番追剧", icon: "heart" },
  { id: "watch_later", label: "稍后再看", icon: "clock", action: true },
  { id: "history", label: "历史记录", icon: "history", action: true },
];

/** 追番类型：原版浮层的下拉只有这两档（`parser/favorite.py` 里 type = 选中项 + 1） */
const FOLLOW_TYPES: Array<[string, string]> = [["1", "追番"], ["2", "追剧"]];
/** 追番状态：取值即 follow/list 的 follow_status（原版 `status_choice.currentIndex()`） */
const FOLLOW_STATUS: Array<[number, string]> = [[0, "全部"], [1, "想看"], [2, "在看"], [3, "看过"]];

/**
 * 页码按钮的取值范围见 `lib/pagerRange.ts`（从原版 `pager.py` 移植，已单测）。
 */

export function FavoritesPage({
  onParse, mid,
}: {
  /** 条目要去解析的链接（收藏夹 / 订阅合集 / 追番 / 稍后再看 / 历史，都由后端或原版语义给全，前端不再自己拼） */
  onParse: (url: string) => void;
  /** 当前登录用户 uid，「在浏览器中打开」要拼空间地址 */
  mid?: number;
}) {
  const { toast } = useToast();
  const [cat, setCat] = useState<CategoryId>("favorite");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<FavFolder[]>([]);
  const [collected, setCollected] = useState<FavFolder[]>([]);
  const [follow, setFollow] = useState<FollowBangumi[]>([]);
  const [pagination, setPagination] = useState<Pagination | undefined>(undefined);
  const [followType, setFollowType] = useState("1");
  const [followStatus, setFollowStatus] = useState(0);
  const [followPage, setFollowPage] = useState(1);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpTo, setJumpTo] = useState("");
  /** 条目右键菜单（原版 `entry_list/list_view.py:52-60`：解析 / 在浏览器中打开） */
  const [menu, setMenu] = useState<{ x: number; y: number; url: string } | null>(null);

  const loadFolders = useCallback(async (kind: "created" | "collected") => {
    setLoading(true); setError("");
    try {
      const r = await listFavorites(kind);
      if (kind === "created") setCreated(r.folders); else setCollected(r.folders);
      /**
       * 「我创建的」那条接口**不返回封面**（只有 id/title/media_count），封面得逐个取
       * `fav/resource/list` 的 `info.cover`（服务端限并发 3 + 缓存，防 412）。
       * 所以这里**不阻塞列表**：列表先用占位图渲染，封面到了再补上。
       */
      const missing = r.folders.filter((f) => !f.cover).map((f) => f.id);
      if (missing.length > 0) {
        void listFavFolderCovers(missing).then(({ covers }) => {
          if (Object.keys(covers).length === 0) return;
          const fill = (list: FavFolder[]) => list.map((f) => (covers[String(f.id)] ? { ...f, cover: covers[String(f.id)] } : f));
          if (kind === "created") setCreated(fill); else setCollected(fill);
        }).catch(() => { /* 封面拿不到就用占位图，不影响列表 */ });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, []);

  const loadFollow = useCallback(async (type: string, status: number, pn: number) => {
    setLoading(true); setError("");
    try {
      const r = await listFollowBangumi(type, status, pn);
      setFollow(r.follow);
      setPagination(r.pagination);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, []);

  const reload = useCallback(() => {
    if (cat === "favorite") void loadFolders("created");
    else if (cat === "subscription") void loadFolders("collected");
    else if (cat === "follow") void loadFollow(followType, followStatus, followPage);
  }, [cat, followType, followStatus, followPage, loadFolders, loadFollow]);

  // 页面：挂载即加载；切分类/筛选/翻页也重新加载
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [cat, followType, followStatus, followPage]);


  const pickCategory = (id: CategoryId) => {
    // 原版这两项 selectable=False：点了就走，不切内容区
    if (id === "watch_later") { onParse("bili23://watch_later"); return; }
    if (id === "history") { onParse("bili23://history"); return; }
    setCat(id);
    if (id === "follow") setFollowPage(1);
  };

  /** 点「⋯」时把菜单锚到按钮下方（触屏没有右键，原版用悬停命令条，这里合并成常驻「⋯」） */
  const openMenuAt = (el: HTMLElement, url: string) => {
    const r = el.getBoundingClientRect();
    setMenu({ x: r.right - 8, y: r.bottom + 2, url });
  };

  const openInBrowser = () => {
    // 原版 on_open_in_browser：收藏夹/订阅 → 空间收藏夹页；追番 → 空间追番页
    if (!mid) return;
    const path = cat === "follow" ? "bangumi" : "favlist";
    window.open(`https://space.bilibili.com/${mid}/${path}`, "_blank", "noopener");
  };

  const goPage = (n: number) => {
    const total = pagination?.totalPages ?? 1;
    if (n < 1 || n > total) {
      toast(tr("无效页码"), "warn");
      return;
    }
    setFollowPage(n);
  };

  const folders = cat === "favorite" ? created : cat === "subscription" ? collected : [];
  const totalPages = pagination?.totalPages ?? 1;
  const totalItems = pagination?.total ?? follow.length;

  return (
    <section className="page">
      <div className="fav-page">
        <nav className="fav-cats" aria-label={tr("收藏夹分类")}>
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`fav-cat${cat === c.id && !c.action ? " active" : ""}`}
              onClick={() => pickCategory(c.id)}
            >
              <Icon name={c.icon} size={18} />
              <span>{c.label}</span>
            </button>
          ))}
          <div className="fav-cats-spacer" />
          {/* 原版这两个按钮在左栏底部（flyout.py:204-214） */}
          <div className="fav-tools">
            <button type="button" className="icon-btn" onClick={reload} title={tr("刷新")} aria-label={tr("刷新")}>
              <Icon name="history" size={18} />
            </button>
            <button type="button" className="icon-btn" onClick={openInBrowser} disabled={!mid} title={tr("在浏览器中打开")} aria-label={tr("在浏览器中打开")}>
              <Icon name="external" size={18} />
            </button>
          </div>
        </nav>

        <div className="fav-main">
          {cat === "follow" && (
            <div className="fav-filters">
              <select className="text-input" value={followType} aria-label={tr("类型")}
                onChange={(e) => { setFollowType(e.target.value); setFollowPage(1); }}>
                {FOLLOW_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <select className="text-input" value={followStatus} aria-label={tr("状态")}
                onChange={(e) => { setFollowStatus(Number(e.target.value)); setFollowPage(1); }}>
                {FOLLOW_STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          )}

          {loading ? (
            <div className="fav-empty"><span className="spinner" /><p className="muted">{tr("加载中…")}</p></div>
          ) : error ? (
            <div className="fav-empty">
              <p className="muted">{error}</p>
              <p className="small muted">请先登录（扫码 / Cookie）</p>
            </div>
          ) : cat === "follow" ? (
            <>
              {follow.length === 0
                ? <div className="fav-empty"><p className="muted">{tr("暂无内容")}</p></div>
                : (
                  <div className="fav-scroll">
                    <div className="fav-grid fav-poster-grid">
                      {follow.map((b, i) => (
                        <div key={b.seasonId} className="fav-cell" style={{ ["--i"]: Math.min(i, 12) } as React.CSSProperties}>
                          <button type="button" className="fav-item fav-poster" onClick={() => onParse(b.url)}
                            onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, url: b.url }); }}>
                            {b.cover
                              ? <img className="fav-poster-cover" src={b.cover} alt="" loading="lazy" referrerPolicy="no-referrer" onLoad={coverLoaded} ref={coverRef} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                              : <div className="fav-poster-cover placeholder"><Icon name="play" size={22} /></div>}
                            {/* 右侧字段顺序对齐原版 poster_item_delegate：标题 / 类型 / 最新集 / 进度 / 简介 */}
                            <span className="fav-item-text">
                              <span className="fav-name">{b.title}</span>
                              {b.type && <span className="fav-sub">{b.type}</span>}
                              {b.newEp && <span className="fav-sub">{b.newEp}</span>}
                              {b.progress && <span className="fav-sub">{b.progress}</span>}
                              {b.desc && <span className="fav-desc">{b.desc}</span>}
                            </span>
                          </button>
                          <button type="button" className="fav-more" title={tr("更多")} aria-label={tr("更多")}
                            onClick={(e) => { e.stopPropagation(); openMenuAt(e.currentTarget, b.url); }}>⋯</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              {/* 分页器（原版 pager.py：箭头 + 页码按钮 + 共 N 页/M 个 + 跳页 + 自动解析；左对齐） */}
              <div className="fav-pager">
                <button type="button" className="fav-pager-arrow" disabled={followPage <= 1} onClick={() => goPage(followPage - 1)} title={tr("上一页")} aria-label={tr("上一页")}>
                  <Icon name="careL" size={12} />
                </button>
                {pagerRange(followPage, totalPages).map((p, i) => (
                  p === "L" || p === "R" ? (
                    <button key={`${p}${i}`} type="button" className="fav-pager-num ellipsis"
                      onClick={() => goPage(p === "L" ? followPage - 5 : followPage + 5)}>…</button>
                  ) : (
                    <button key={p} type="button" className={`fav-pager-num${p === followPage ? " active" : ""}`} onClick={() => goPage(p)}>{p}</button>
                  )
                ))}
                <button type="button" className="fav-pager-arrow" disabled={followPage >= totalPages} onClick={() => goPage(followPage + 1)} title={tr("下一页")} aria-label={tr("下一页")}>
                  <Icon name="careR" size={12} />
                </button>
                <span className="fav-pager-count">共 {totalPages} 页 / {totalItems} 个</span>
                <button type="button" className="icon-btn sm" onClick={() => setJumpOpen((v) => !v)} title={tr("跳转到页面")} aria-label={tr("跳转到页面")}>
                  <Icon name="external" size={16} />
                </button>
                <button type="button" className="icon-btn sm" disabled title={tr("自动解析分页")} aria-label={tr("自动解析分页")}>
                  <Icon name="gear" size={16} />
                </button>
                {jumpOpen && (
                  <span className="fav-jump-wrap">
                    <input className="text-input fav-jump" type="number" min={1} max={totalPages} placeholder={tr("页码")}
                      value={jumpTo} onChange={(e) => setJumpTo(e.target.value)} aria-label={tr("跳转到页面")}
                      onKeyDown={(e) => { if (e.key === "Enter") { goPage(Number(jumpTo) || 1); setJumpOpen(false); setJumpTo(""); } }} autoFocus />
                    <button type="button" className="btn sm" onClick={() => { goPage(Number(jumpTo) || 1); setJumpOpen(false); setJumpTo(""); }}>{tr("跳转")}</button>
                  </span>
                )}
              </div>
            </>
          ) : folders.length === 0 ? (
            <div className="fav-empty"><p className="muted">{tr("暂无内容")}</p></div>
          ) : (
            <div className="fav-scroll">
              <div className="fav-grid">
                {folders.map((f, i) => (
                  <div key={f.id} className="fav-cell" style={{ ["--i"]: Math.min(i, 12) } as React.CSSProperties}>
                    <button type="button" className="fav-item" onClick={() => onParse(f.url)}
                      onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, url: f.url }); }}>
                      {f.cover
                        ? <img className="fav-thumb" src={f.cover} alt="" loading="lazy" referrerPolicy="no-referrer" onLoad={coverLoaded} ref={coverRef} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                        : <div className="fav-thumb placeholder"><Icon name="folder" size={22} /></div>}
                      {/* 右侧：标题 + 「N 个项目」（原版 entry_item_delegate 的 `{count} items`） */}
                      <span className="fav-item-text">
                        <span className="fav-name">{f.title}</span>
                        <span className="fav-sub">{f.mediaCount} 个项目</span>
                      </span>
                    </button>
                    <button type="button" className="fav-more" title={tr("更多")} aria-label={tr("更多")}
                      onClick={(e) => { e.stopPropagation(); openMenuAt(e.currentTarget, f.url); }}>⋯</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 条目右键菜单（原版 entry_list/list_view.py:52-60）：解析 / 在浏览器中打开 */}
      {menu && (
        <div className="ctx-layer" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }}>
          <div className="ctx-menu" style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 110) }}
            onClick={(e) => e.stopPropagation()}>
            <button type="button" className="ctx-item" onClick={() => { onParse(menu.url); setMenu(null); }}>{tr("解析")}</button>
            <button type="button" className="ctx-item" onClick={() => { window.open(menu.url, "_blank", "noopener"); setMenu(null); }}>{tr("在浏览器中打开")}</button>
          </div>
        </div>
      )}
    </section>
  );
}
