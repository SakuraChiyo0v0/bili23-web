import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api.js";
import type { AppConfig, DownloadOptions, MediaItem, MediaOptionSummary, ParseHistoryEntry, ParseResult } from "../types.js";
import { Icon, type IconName } from "../components/icons.js";
import { DownloadOptions as DownloadOptionsPanel } from "../components/DownloadOptions.js";
import { cn, formatDuration, formatTime } from "../utils.js";

interface ParseViewProps {
  config: AppConfig;
  onToast: (message: string, tone?: "success" | "error") => void;
  onTasksChanged: () => void;
  onNavigate: (view: "tasks") => void;
}

interface TypeOption {
  id: string;
  label: string;
  description: string;
  icon: IconName;
  queryLabel: string;
  queryHint: string;
  supportsKeyword?: boolean;
  supportsWeek?: boolean;
  supportsPaging?: boolean;
  direct?: boolean;
}

const TYPE_OPTIONS: TypeOption[] = [
  { id: "auto", label: "智能解析", description: "自动识别链接类型", icon: "sparkles", queryLabel: "B 站链接", queryHint: "支持 b23.tv、BV、av、番剧、课程、收藏夹等链接，可一次粘贴多行", direct: true },
  { id: "video", label: "投稿视频", description: "视频、分P、合集", icon: "play", queryLabel: "投稿链接", queryHint: "https://www.bilibili.com/video/BV..." },
  { id: "bangumi", label: "番剧", description: "番剧 / 影视", icon: "play", queryLabel: "番剧链接", queryHint: "https://www.bilibili.com/bangumi/play/..." },
  { id: "cheese", label: "课程", description: "课堂 / 付费课程", icon: "play", queryLabel: "课程链接", queryHint: "https://www.bilibili.com/cheese/play/..." },
  { id: "lesson", label: "课程章节", description: "课程分节内容", icon: "play", queryLabel: "课程章节链接", queryHint: "https://www.bilibili.com/lesson/..." },
  { id: "audio", label: "音乐", description: "音频与 MV", icon: "play", queryLabel: "音乐链接", queryHint: "https://www.bilibili.com/audio/..." },
  { id: "space", label: "UP 主空间", description: "UID / 用户名 / 主页", icon: "search", queryLabel: "UP 主 UID 或用户名", queryHint: "也可以直接粘贴 space.bilibili.com 链接", supportsKeyword: true, supportsPaging: true },
  { id: "favlist", label: "收藏夹", description: "收藏夹批量下载", icon: "folder", queryLabel: "收藏夹链接或 ID", queryHint: "https://space.bilibili.com/.../favlist?fid=...", supportsKeyword: true, supportsPaging: true },
  { id: "history", label: "历史记录", description: "最近观看内容", icon: "history", queryLabel: "关键词（可选）", queryHint: "登录后可用，留空则返回默认历史", supportsKeyword: true, supportsPaging: true },
  { id: "watch_later", label: "稍后再看", description: "稍后再看列表", icon: "history", queryLabel: "关键词（可选）", queryHint: "登录后可用，留空则返回全部稍后再看", supportsKeyword: true, supportsPaging: true },
  { id: "popular", label: "每周必看", description: "每周热门榜单", icon: "sparkles", queryLabel: "每周期数", queryHint: "输入 1 开始的期数", supportsWeek: true },
  { id: "list", label: "合集 / 列表", description: "视频合集和列表", icon: "folder", queryLabel: "合集链接", queryHint: "https://www.bilibili.com/medialist/play/..." },
  { id: "festival", label: "活动页", description: "活动页跳转解析", icon: "external", queryLabel: "活动页链接", queryHint: "会自动跳转到实际视频内容" },
];

function itemKey(item: MediaItem): string {
  return item.id;
}

function parseInputLines(value: string): string[] {
  return value.split(/\r?\n|,|;/).map((line) => line.trim()).filter(Boolean);
}

function ResultCard({ item, selected, onToggle }: { item: MediaItem; selected: boolean; onToggle: () => void }) {
  return (
    <button type="button" className={cn("result-card", selected && "is-selected")} onClick={onToggle}>
      <span className="result-cover">
        {item.cover ? <img src={item.cover} alt="" loading="lazy" /> : <span className="cover-placeholder"><Icon name="play" size={22} /></span>}
        <span className="duration-badge">{formatDuration(item.duration)}</span>
        {item.badge ? <span className="content-badge">{item.badge}</span> : null}
        <span className={cn("select-dot", selected && "is-on")}>{selected ? <Icon name="check" size={14} /> : null}</span>
      </span>
      <span className="result-body">
        <span className="result-title">{item.title}</span>
        <span className="result-meta"><span>{item.owner.name || "未知 UP"}</span><span>·</span><span>P{item.page}</span></span>
      </span>
    </button>
  );
}

export function ParseView({ config, onToast, onTasksChanged, onNavigate }: ParseViewProps) {
  const [activeType, setActiveType] = useState("auto");
  const [query, setQuery] = useState("");
  const [keyword, setKeyword] = useState("");
  const [weekNum, setWeekNum] = useState("1");
  const [pn, setPn] = useState("1");
  const [pages, setPages] = useState("1");
  const [searchMode, setSearchMode] = useState<"page" | "range" | "all">("page");
  const [results, setResults] = useState<ParseResult[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [parseHistory, setParseHistory] = useState<ParseHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showOptions, setShowOptions] = useState(false);
  const [media, setMedia] = useState<MediaOptionSummary>();
  const [pendingOptions, setPendingOptions] = useState<DownloadOptions>();
  const [duplicates, setDuplicates] = useState<Array<{ itemId: string; title: string }>>([]);
  const [duplicateForce, setDuplicateForce] = useState(false);

  const typeOption = TYPE_OPTIONS.find((option) => option.id === activeType) ?? TYPE_OPTIONS[0]!;
  const allItems = useMemo(() => results.flatMap((result) => result.items), [results]);
  const selectedItems = allItems.filter((item) => selected.has(itemKey(item)));
  const firstSelectedId = selectedItems[0]?.id;

  useEffect(() => {
    api.listParseHistory().then(setParseHistory).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!firstSelectedId) {
      setMedia(undefined);
      return;
    }
    let cancelled = false;
    api.mediaOptions(firstSelectedId).then((value) => {
      if (!cancelled) setMedia(value);
    }).catch((err) => {
      if (!cancelled) {
        setMedia(undefined);
        if (err instanceof ApiError && err.code !== "LOGIN_REQUIRED") onToast(err.message, "error");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [firstSelectedId, onToast]);

  const toggleItem = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((current) => current.size === allItems.length ? new Set() : new Set(allItems.map(itemKey)));
  };

  /** 依据搜索范围模式派生分页参数：page=仅当前页 / range=pn..pn+pages-1 / all=从第1页翻到末页 */
  const buildPagingParams = (): { pn: number; pages: number } => {
    const pnNum = Math.max(1, Number(pn) || 1);
    if (searchMode === "all") {
      // 后端 #parsePagedUrl 翻到 pagination.totalPages 会自动提前结束，故给足够大的翻页数即可翻遍全部
      return { pn: 1, pages: 9999 };
    }
    if (searchMode === "range") {
      return { pn: pnNum, pages: Math.max(1, Number(pages) || 1) };
    }
    return { pn: pnNum, pages: 1 };
  };

  const runParse = async () => {
    setLoading(true);
    setError("");
    setResults([]);
    setSelected(new Set());
    setDuplicates([]);
    try {
      const request = activeType === "auto"
        ? { urls: parseInputLines(query) }
        : {
            type: activeType,
            query,
            ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
            ...(typeOption.supportsWeek ? { weekNum: Math.max(1, Number(weekNum) || 1) } : {}),
            ...(typeOption.supportsPaging ? buildPagingParams() : {}),
          };
      const parsed = await api.parse(request);
      setResults(parsed);
      const parsedItems = parsed.flatMap((entry) => entry.items);
      if (parsedItems.length > 0) {
        setSelected(new Set(parsedItems.map(itemKey)));
        onToast(`解析完成，共 ${parsedItems.length} 个条目`, "success");
      } else {
        onToast("解析完成，但没有找到可下载条目", "error");
      }
      const history = await api.listParseHistory().catch(() => parseHistory);
      setParseHistory(history);
    } catch (err) {
      const message = err instanceof Error ? err.message : "解析失败";
      setError(message);
      onToast(message, "error");
    } finally {
      setLoading(false);
    }
  };

  const openOptions = () => {
    if (selectedItems.length === 0) {
      onToast("请先选择要下载的条目", "error");
      return;
    }
    setShowOptions(true);
  };

  const createDownload = async (options: DownloadOptions, force = false) => {
    setPendingOptions(options);
    try {
      const result = await api.createDownload({ itemIds: selectedItems.map(itemKey), options, force });
      setShowOptions(false);
      setDuplicates([]);
      if (result.duplicates.length > 0) {
        setDuplicates(result.duplicates);
      } else {
        onToast(`已创建 ${result.tasks.length} 个下载任务`, "success");
        onTasksChanged();
        onNavigate("tasks");
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === "DUPLICATE") {
        setDuplicates(err.duplicates ?? []);
        setDuplicateForce(true);
        onToast("检测到重复内容，可选择继续下载", "error");
        return;
      }
      onToast(err instanceof Error ? err.message : "创建任务失败", "error");
    }
  };

  const useParseHistory = (entry: ParseHistoryEntry) => {
    setQuery(entry.url);
    setActiveType("auto");
  };

  return (
    <div className="view-stack">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">PARSE WORKSPACE</p>
          <h1>把想留下的内容，<em>稳稳存进 NAS。</em></h1>
          <p className="hero-description">支持投稿、番剧、课程、音乐、空间、收藏夹等类型。解析后统一选择画质、附加内容和命名规则。</p>
        </div>
        <div className="hero-stat"><strong>{allItems.length || "0"}</strong><span>当前解析条目</span></div>
      </section>

      <section className="parse-panel">
        <div className="type-strip" role="tablist" aria-label="解析类型">
          {TYPE_OPTIONS.map((option) => (
            <button key={option.id} type="button" role="tab" aria-selected={activeType === option.id} className={cn("type-chip", activeType === option.id && "is-active")} onClick={() => { setActiveType(option.id); setError(""); }}>
              <Icon name={option.icon} size={15} />
              <span>{option.label}</span>
            </button>
          ))}
        </div>

        <div className="parse-compose">
          <div className="parse-compose-head">
            <div>
              <p className="eyebrow">{typeOption.description}</p>
              <h2>{typeOption.queryLabel}</h2>
            </div>
            <span className="kbd-hint">支持多行 / 逗号分隔</span>
          </div>
          <textarea value={query} onChange={(event) => setQuery(event.target.value)} rows={activeType === "auto" ? 3 : 2} placeholder={typeOption.queryHint} />
          {typeOption.supportsKeyword ? (
            <div className="parse-extra-row">
              <label className="compact-field"><span>关键词</span><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="可选，按关键词筛选" /></label>
            </div>
          ) : null}
          {typeOption.supportsPaging ? (
            <div className="parse-extra-row">
              <div className="segmented" role="group" aria-label="搜索范围">
                <button type="button" className={searchMode === "page" ? "is-active" : ""} onClick={() => setSearchMode("page")}>仅当前页</button>
                <button type="button" className={searchMode === "range" ? "is-active" : ""} onClick={() => setSearchMode("range")}>指定范围</button>
                <button type="button" className={searchMode === "all" ? "is-active" : ""} onClick={() => setSearchMode("all")}>搜索全部</button>
              </div>
              {searchMode === "page" ? (
                <label className="compact-field"><span>页号</span><input inputMode="numeric" value={pn} onChange={(event) => setPn(event.target.value.replace(/\D/g, ""))} /></label>
              ) : null}
              {searchMode === "range" ? (
                <>
                  <label className="compact-field"><span>起始页</span><input inputMode="numeric" value={pn} onChange={(event) => setPn(event.target.value.replace(/\D/g, ""))} /></label>
                  <label className="compact-field"><span>翻页数</span><input inputMode="numeric" value={pages} onChange={(event) => setPages(event.target.value.replace(/\D/g, ""))} /></label>
                </>
              ) : null}
              {searchMode === "all" ? (
                <span className="parse-tip"><Icon name="info" size={15} /> 将从第 1 页连续解析直到最后一页（受 B 站风控限制，请谨慎使用）</span>
              ) : null}
            </div>
          ) : null}
          {typeOption.supportsWeek ? (
            <div className="parse-extra-row">
              <label className="compact-field"><span>每周期数</span><input inputMode="numeric" value={weekNum} onChange={(event) => setWeekNum(event.target.value.replace(/\D/g, ""))} /></label>
            </div>
          ) : null}
          <div className="parse-actions">
            <span className="parse-tip"><Icon name="info" size={15} /> 登录态会影响稍后再看、历史和高画质内容</span>
            <button className="button button-primary" type="button" onClick={runParse} disabled={loading}>
              <Icon name={loading ? "retry" : "search"} size={17} className={loading ? "spin" : ""} />
              {loading ? "解析中..." : "开始解析"}
            </button>
          </div>
          {error ? <div className="inline-error"><Icon name="info" size={16} /> {error}</div> : null}
        </div>
      </section>

      {allItems.length > 0 ? (
        <section className="results-panel">
          <div className="results-toolbar">
            <div>
              <p className="eyebrow">PARSED ITEMS</p>
              <h2>解析结果 <span className="count-pill">{allItems.length}</span></h2>
            </div>
            <div className="toolbar-actions">
              <button className="button button-ghost" type="button" onClick={toggleAll}><Icon name="check" size={16} /> {selected.size === allItems.length ? "取消全选" : "全选"}</button>
              <button className="button button-primary" type="button" onClick={openOptions}><Icon name="download" size={16} /> 下载所选（{selected.size}）</button>
            </div>
          </div>
          {duplicates.length > 0 ? (
            <div className="duplicate-panel">
              <div><strong>发现重复内容</strong><span>{duplicates.map((entry) => entry.title).join("、")}</span></div>
              <button className="button button-danger-soft" type="button" onClick={() => pendingOptions && createDownload(pendingOptions, true)} disabled={!duplicateForce}>仍然下载</button>
            </div>
          ) : null}
          <div className="result-grid">
            {results.flatMap((result) => result.items.map((item) => <ResultCard key={itemKey(item)} item={item} selected={selected.has(itemKey(item))} onToggle={() => toggleItem(itemKey(item))} />))}
          </div>
        </section>
      ) : (
        <section className="empty-panel">
          <div className="empty-icon"><Icon name="sparkles" size={24} /></div>
          <h2>从一个链接开始</h2>
          <p>选择上方类型，粘贴内容后点击「开始解析」。解析完成后可以批量选择并创建下载任务。</p>
          {parseHistory.length > 0 ? (
            <div className="history-shortcut">
              <span>最近解析：</span>
              {parseHistory.slice(0, 3).map((entry) => <button key={entry.id} type="button" onClick={() => useParseHistory(entry)}>{entry.title || entry.url}</button>)}
            </div>
          ) : null}
        </section>
      )}

      {parseHistory.length > 0 ? (
        <section className="history-panel">
          <div className="section-heading"><span className="section-index">04</span><div><h3>解析历史</h3><p>保留最近解析过的链接，方便再次处理。</p></div></div>
          <div className="history-list">
            {parseHistory.slice(0, 8).map((entry) => (
              <div className="history-row" key={entry.id}>
                <button className="history-main" type="button" onClick={() => useParseHistory(entry)}>
                  <span className="history-type">{entry.type}</span>
                  <span><strong>{entry.title || "未命名内容"}</strong><small>{entry.itemCount} 个条目 · {formatTime(entry.createdAt)}</small></span>
                </button>
                <button className="icon-button" type="button" aria-label="删除解析历史" onClick={async () => { await api.deleteParseHistory(entry.id); setParseHistory((current) => current.filter((item) => item.id !== entry.id)); }}><Icon name="trash" size={16} /></button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {showOptions ? (
        <DownloadOptionsPanel
          config={config}
          media={media}
          selectedCount={selectedItems.length}
          onCancel={() => setShowOptions(false)}
          onSubmit={(options) => { setDuplicateForce(false); void createDownload(options); }}
          onToast={onToast}
        />
      ) : null}
    </div>
  );
}