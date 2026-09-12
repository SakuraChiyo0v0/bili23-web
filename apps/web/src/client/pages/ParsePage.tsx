import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createTasks, parseUrl } from "../services/client";
import type { ParseResult } from "../services/types";
import { useDownloadOptions } from "../store/useDownloadOptions";
import { DownloadOptionsDialog } from "../components/DownloadOptionsDialog";
import { useParseSession } from "../store/useParseSession";
import { useSettingsStore } from "../store/useSettingsStore";
import { useToast } from "../lib/toast";
import { ParseTree, scrollToTreeNode } from "../components/ParseTree";
import { ParseHistoryDialog } from "../components/ParseHistoryDialog";
import { Pager } from "../components/Pager";
import { ParseSegment, type ParseBottomView } from "../components/ParseSegment";
import { AutoParseDialog } from "../components/AutoParseDialog";
import { InteractiveVideoDialog } from "../components/InteractiveVideoDialog";
import { MultiPartListsDialog } from "../components/MultiPartListsDialog";
import type { MediaItem } from "../services/types";
import { TeachingTip } from "../components/TeachingTip";
import { CATEGORY_LABEL, searchNodes } from "../lib/parseTree";
import { parseLineNumbers } from "../lib/batchSelect";
import { LOCAL_FLAG_AUTO_PARSE_TIP, getLocalFlag, setLocalFlag } from "../lib/localFlags";
import { useTasksStore } from "../store/useTasksStore";
import { detectBiliLink } from "../lib/clipboardWatch";
import { Icon } from "../lib/icons";
import { t as tr, trp } from "../lib/i18n";
import { Overlay } from "../components/Overlay";

export function ParsePage() {
  const session = useParseSession();
  const [batchOpen, setBatchOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  /**
   * 底部「搜索结果 / 分页」两个组件（原版 `SegmentedWidget`）。
   * `matchIds` 是本次本地搜索命中的节点 id（原版 `tree_view.search_keywords` 的返回值），
   * `matchIndex` 是当前定位到第几个（原版 SearchWidget 的 current_match_index）。
   */
  const [bottomView, setBottomView] = useState<ParseBottomView>("pager");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [matchIds, setMatchIds] = useState<string[]>([]);
  const [matchIndex, setMatchIndex] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  /** 「自动解析分页」对话框（原版 AutoParseDialog：范围 + 解析间隔 + 两个勾选） */
  const [autoOpen, setAutoOpen] = useState(false);
  /** 教学气泡的锚点元素（分页器上的「自动解析分页」按钮） */
  const autoParseBtnRef = useRef<HTMLElement | null>(null);
  const [autoTipOpen, setAutoTipOpen] = useState(false);
  const setTasks = useTasksStore((s) => s.setTasks);
  /**
   * 剪贴板监控（Web 改写，见 `lib/clipboardWatch.ts`）：
   * 页面**重新聚焦**时读一次剪贴板；命中 B 站链接且与上次不同 → 填入输入框 + 提示。
   * **不自动解析**（浏览器里"悄悄开始解析/下载"比桌面版更不可接受，且 readText 需要授权，
   * 被拒时静默跳过，不打扰用户）。
   */
  const lastClipRef = useRef<string>("");
  const { toast, toastLong } = useToast();
  const parsePages = (t: string) => ["space","favlist","history","watch_later","list"].includes(t);
  /**
   * 当前**结果**所属的分类。
   * ⚠️ 判断"这份结果能不能翻页 / 能不能服务端搜索"要用它，**不能**用 `session.parseType`：
   * 从收藏夹页点条目进来时 parseType 是 `auto`，而结果其实是 `favlist` ——
   * 之前拿 parseType 判断，页码点了直接 return（"点第 2/3/4 页没反应"就是这么来的）。
   */
  const resultType = session.results[0]?.type ?? session.parseType;
  const serverSearchable = ["space","favlist","history","watch_later"].includes(resultType);

  const typePlaceholder = (t: string) => { if (t === "auto") return "粘贴链接 / BV / av / ep / ss / md / 收藏夹 / 空间…"; if (t === "space") return "UP 主 UID 或主页链接"; if (t === "favlist") return "收藏夹链接 / 列表 ID"; if (t === "watch_later") return "（自动）稍后再看"; if (t === "history") return "（自动）历史记录"; if (t === "popular") return "每周必看（可留空，期数在工具栏）"; return "粘贴相应分类的链接"; };

  // popular 期数取值依据：服务端 popular 分支只认 weekNum、不看 query，
  // 而用户常直接粘贴每周必看链接（自带 ?num=N），所以链接里的 num= 优先，
  // 其次是工具栏的期数输入框（默认第 1 期，与桌面缺省一致）
  const weeklyNumFromInput = (t: string): number | undefined => {
    const m = /[?&]num=(\d+)/.exec(t);
    const n = m?.[1] !== undefined ? Number(m[1]) : NaN;
    return Number.isInteger(n) && n > 0 ? n : undefined;
  };

  const doParse = useCallback(async (opts?: { interactiveAll?: boolean }) => {
    const input = session.input.trim();
    // 这几类的链接是"（自动）"的（历史记录/稍后再看靠登录态，每周必看只取期数），允许留空。
    // ⚠️ 之前只放行了 popular，于是选「历史记录」点解析会被"请先输入链接"挡掉 —— 实测才发现。
    const optionalInput = ["popular", "history", "watch_later"];
    if (!input && !optionalInput.includes(session.parseType)) {
      toast(tr("请先输入链接或关键词"), "warn");
      return;
    }
    // 用户主动解析 = 换了一份结果，上一条搜索关键词不再适用（原版 `reset_search()`）
    setSearchKeyword("");
    session.start();
    try {
      let results;
      if (session.parseType === "auto") {
        const urls = input.split(/\r?\n|,|;/).map((s) => s.trim()).filter(Boolean);
        const r = await parseUrl({ urls, ...(opts?.interactiveAll ? { interactiveAll: true } : {}) });
        results = r.results;
      } else {
        const weekNum = session.parseType === "popular" ? (weeklyNumFromInput(input) ?? session.weekNum) : undefined;
        const r = await parseUrl({
          type: session.parseType,
          query: input,
          ...(parsePages(session.parseType) ? { pn: session.page, pages: session.autoPages } : {}),
          ...(weekNum !== undefined ? { weekNum } : {}),
          ...(opts?.interactiveAll ? { interactiveAll: true } : {}),
        });
        results = r.results;
      }
      if (!results.length) throw new Error("解析结果为空");
      session.success(results);
      // 互动视频第一段：只回报"检测到互动视频"，不弹"解析完成"（树里只有稿件本身那几项）
      if (results.some((r) => r.interactiveDetected)) return;
      toast(`解析完成，共 ${results.reduce((n, r) => n + r.items.length, 0)} 个条目`, "ok");
    } catch (e) {
      session.fail(e instanceof Error ? e.message : String(e));
      toastLong(tr("解析失败"), e instanceof Error ? e.message : String(e), "err");
    }
  }, [session, toast]);

  /**
   * 从收藏夹页点条目过来时**直接开解析**（原版浮层点条目就是这个行为）。
   * 走的是与「解析」按钮同一个 `doParse()` —— 不另开一条"自动解析"路径，
   * 免得两套逻辑慢慢长歪。
   */
  useEffect(() => {
    if (!session.pendingAutoRun) return;
    session.consumeAutoRun();
    void doParse();
    /* eslint-disable-next-line */
  }, [session.pendingAutoRun]);

  const { openDialog } = useDownloadOptions();
  const cfg = useSettingsStore((st) => st.config);
  const saveConfig = useSettingsStore((st) => st.save);

  // 剪贴板监控（Web 改写）：聚焦时读一次，命中只填入不自动解析
  useEffect(() => {
    if (cfg?.behavior?.monitorClipboard !== true) return;
    const onFocus = async () => {
      try {
        const text = await navigator.clipboard?.readText();
        const link = detectBiliLink(text);
        if (!link || link === lastClipRef.current) return;
        lastClipRef.current = link;
        session.setInput(link);
        session.setParseType("auto");
        toast(tr("已从剪贴板填入链接，点「解析」开始"), "ok");
      } catch {
        // 未授权 / 非安全上下文 / 不支持 —— 静默跳过（用户还能手动粘贴）
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [cfg?.behavior?.monitorClipboard, session, toast]);

  const doDownload = useCallback(async () => {
    const leaves = session.selectedLeaves();
    if (!leaves.length) { toast(tr("请先勾选要下载的条目"), "warn"); return; }
    // 对齐桌面 Behavior > 下载前弹下载选项框：开启（默认）→ 弹窗；关闭 → 按默认选项直接创建
    if (cfg?.behavior.showDownloadOptionsDialog !== false) {
      openDialog(leaves);
      return;
    }
    const ids = leaves.map((i) => i.id);
    const container = cfg?.download?.defaultContainer === "mkv" ? ("mkv" as const) : ("mp4" as const);
    const options = {
      downloadVideo: true,
      downloadAudio: true,
      mergeVideoAudio: true,
      container,
    };
    try {
      const { tasks, duplicates } = await createTasks(ids, options);
      toast(`已创建 ${tasks.length} 个下载任务`, "ok");
      // 重复项由服务端按重复策略过滤：这里必须报出数量，否则"只建了一部分"看起来像没反应
      // （本路径是用户关掉"下载前弹下载选项框"后的直下模式，故只提示、不弹强制下载窗）
      if (duplicates.length) toast(`已跳过 ${duplicates.length} 个重复项`, "warn");
    } catch (e) {
      const err = e as Error & { code?: string; duplicates?: Array<{ itemId: string; title: string }> };
      if (err.code === "DUPLICATE" || (err.duplicates && err.duplicates.length)) {
        toast(`已跳过 ${err.duplicates?.length ?? ids.length} 个重复项`, "warn");
      } else {
        toast("创建任务失败：" + (e instanceof Error ? e.message : String(e)), "err");
      }
    }
  }, [session, cfg, openDialog, toast]);

  /**
   * 「解析此项」（原版 `tree_view.py:616-619` 是 `parse_url.emit(item.url)`）：
   * **拿这一项的链接重新解析一次**，替换当前结果 —— 不是"懒展开"。
   * 单独写一个函数而不是 setInput + doParse：doParse 读的是渲染时快照的 input，改完立刻调会读到旧值。
   */
  const parseItemUrl = useCallback(async (url: string) => {
    session.setInput(url);
    session.setParseType("auto");
    session.start();
    try {
      const r = await parseUrl({ urls: [url] });
      if (!r.results.length) throw new Error("解析结果为空");
      session.success(r.results);
      toast(`解析完成，共 ${r.results.reduce((n, x) => n + x.items.length, 0)} 个条目`, "ok");
    } catch (e) {
      session.fail(e instanceof Error ? e.message : String(e));
      toastLong(tr("解析失败"), e instanceof Error ? e.message : String(e), "err");
    }
  }, [session, toast]);

  /**
   * 「解析每页后自动加入下载列表」：把当前解析出的全部条目直接建成下载任务
   * （原版 `task_manager.create(node.get_all_children(to_dict=True), show_toast=False)`，
   * 用全局默认选项；重复项按服务端策略处理，这里只报数量）。
   */
  const autoAddToDownloadList = useCallback(async () => {
    const items = useParseSession.getState().selectedLeaves();
    if (items.length === 0) return;
    try {
      const { tasks, duplicates } = await createTasks(items.map((i) => i.id), {});
      if (tasks.length) setTasks(tasks);
      const skipped = duplicates.length ? `，跳过重复 ${duplicates.length} 个` : "";
      toast(`已自动加入下载列表：${tasks.length} 个${skipped}`, tasks.length ? "ok" : "warn");
    } catch (e) {
      toastLong(tr("自动加入下载列表失败"), e instanceof Error ? e.message : String(e), "err");
    }
  }, [toast, setTasks]);

  /**
   * 翻到某一页（原版底部 Pager 的行为：点页码 → 重新解析那一页，替换当前结果）。
   * `pages>1` 时是「自动解析分页」：从该页起连解析 N 页并聚合。
   */
  const parseAtPage = useCallback(async (pn: number, pages = 1, autoAdd = false) => {
    // 用**结果**里带分页那条的类型（理由见 resultType 的注释）：从收藏夹页点进来时 parseType 还是 auto
    const type = session.results.find((r) => r.pagination)?.type ?? session.results[0]?.type ?? session.parseType;
    if (!parsePages(type)) return;
    session.setPage(pn);
    session.start();
    try {
      const r = await parseUrl({ type, query: session.input.trim(), pn, pages });
      if (!r.results.length) throw new Error("解析结果为空");
      session.success(r.results);
      // 「解析每页后自动加入下载列表」（原版 `episode/dynamic.py:107-108`
      // 每解析完一页就把该页全部条目交给 task_manager.create）
      if (autoAdd) await autoAddToDownloadList();
    } catch (e) {
      session.fail(e instanceof Error ? e.message : String(e));
      toastLong(tr("解析失败"), e instanceof Error ? e.message : String(e), "err");
    }
  }, [session, toast, autoAddToDownloadList]);

  const leaves = session.selectedLeaves();
  /** 状态行分类名与总数（原版 `item_count_label`：`{category_name}（已选择 N 项，共 M 项）`） */
  const categoryLabel = tr(CATEGORY_LABEL[session.results[0]?.type ?? ""] ?? "解析结果");
  const totalItems = session.results.reduce((n, r) => n + r.items.length, 0);
  /** 结果里的分页信息（原版底部 Pager 靠它；空间/收藏夹/历史/稍后再看/合集才有） */
  const pagination = session.results.find((r) => r.pagination)?.pagination;
  const matchSet = useMemo(() => new Set(matchIds), [matchIds]);

  /** 新的解析结果到达时清空上一次搜索并回到分页组件（原版 `reset_search()` + `check_extra_data`）。
   *  关键词不在这里清（服务端搜索刚写完关键词就换了结果），改由用户主动解析时清。 */
  useEffect(() => {
    setMatchIds([]);
    setMatchIndex(0);
    setBottomView(session.results.some((r) => r.pagination) ? "pager" : "search");
  }, [session.results]);

  /**
   * 分页结果到达后的两件事（原版 `check_extra_data`，`parse.py:65-79`）：
   * ① 开了「自动显示此对话框」→ 直接弹自动解析分页对话框；
   * ② 否则，若总页数>1 且这个浏览器没看过 → 在分页器的自动解析按钮上挂一次教学气泡。
   * 原版在**显示**气泡时就把"已看过"写进配置（`parse.py:234`），这里同样在显示时落标记。
   */
  useEffect(() => {
    if (session.state !== "success") return;
    if (!pagination || pagination.totalPages <= 1) { setAutoTipOpen(false); return; }
    if (cfg?.behavior?.showAutoParseDialog) { setAutoOpen(true); return; }
    if (getLocalFlag(LOCAL_FLAG_AUTO_PARSE_TIP)) return;
    // 分页器要等这一帧渲染完才拿得到锚点元素
    const timer = setTimeout(() => {
      if (!autoParseBtnRef.current) return;
      setLocalFlag(LOCAL_FLAG_AUTO_PARSE_TIP);
      setAutoTipOpen(true);
    }, 60);
    return () => clearTimeout(timer);
  }, [session.state, pagination, cfg?.behavior?.showAutoParseDialog]);

  const dismissAutoTip = useCallback(() => {
    setLocalFlag(LOCAL_FLAG_AUTO_PARSE_TIP);
    setAutoTipOpen(false);
  }, []);

  /**
   * 互动视频两段式（原版 `parse.py:181-188`）：第一段解析只回报"检测到互动视频"，
   * 这里弹「检测到互动视频，请选择操作」；确认后带 `interactiveAll` 重新解析展开分支节点。
   */
  const [interactiveOpen, setInteractiveOpen] = useState(false);
  const [interactiveTitle, setInteractiveTitle] = useState<string | undefined>(undefined);
  useEffect(() => {
    const hit = session.results.find((r) => r.interactiveDetected);
    if (!hit) { setInteractiveOpen(false); return; }
    setInteractiveTitle(hit.title);
    setInteractiveOpen(true);
  }, [session.results]);

  /** 「分P视频列表」对话框（原版 MultiPartListsDialog）：收藏夹里的分P视频才可用 */
  const [partsItem, setPartsItem] = useState<MediaItem | null>(null);

  /** 确认下载勾选的分P（原版 `signal_bus.download.create_task.emit(checked, True, None)`） */
  const downloadParts = useCallback(async (picked: MediaItem[]) => {
    try {
      const { tasks, duplicates } = await createTasks(picked.map((p) => p.id), {});
      if (tasks.length) setTasks(tasks);
      const skipped = duplicates.length ? `，跳过重复 ${duplicates.length} 个` : "";
      toast(`已创建 ${tasks.length} 个下载任务${skipped}`, tasks.length ? "ok" : "warn");
      setPartsItem(null);
    } catch (e) {
      toast("创建任务失败：" + (e instanceof Error ? e.message : String(e)), "err");
    }
  }, [toast, setTasks]);

  /** 跳转到第 i 个命中项（原版 SearchWidget 的 prev/next：`_update_label_and_scroll`） */
  const gotoMatch = useCallback((i: number) => {
    if (matchIds.length === 0) return;
    const n = ((i % matchIds.length) + matchIds.length) % matchIds.length;
    setMatchIndex(n);
    scrollToTreeNode(matchIds[n]!);
  }, [matchIds]);

  /**
   * 本地搜索（原版 `on_search` 的 else 分支）：只高亮 + 定位，不过滤掉未命中的行。
   * 命中项可能藏在折叠的容器里，所以先全部展开再滚过去（原版也是 `_schedule_expand_all`）。
   */
  const runLocalSearch = useCallback((kw: string) => {
    const hits = searchNodes(session.tree, kw);
    setSearchKeyword(kw);
    setMatchIds(hits);
    setMatchIndex(0);
    setBottomView("search");
    if (hits.length > 0) {
      session.expandAll(true);
      setTimeout(() => scrollToTreeNode(hits[0]!), 50);
    }
  }, [session]);

  /** 服务端搜索（原版 `on_server_search`：关键词写回链接后重新解析，翻页沿用该链接） */
  const runServerSearch = useCallback(async (kw: string) => {
    if (!serverSearchable) return;
    setSearchOpen(false);
    session.start();
    try {
      const body = { type: resultType as "space" | "favlist" | "history" | "watch_later", query: session.input.trim() };
      const r = await parseUrl(kw ? { ...body, keyword: kw } : body);
      if (!r.results.length) throw new Error("没有匹配结果");
      session.success(r.results);
      setSearchKeyword(kw);
      toast(kw ? `站内搜索“${kw}”完成` : "已清除搜索关键词", "ok");
    } catch (e) {
      session.fail(e instanceof Error ? e.message : String(e));
      toast("搜索失败：" + (e instanceof Error ? e.message : String(e)), "err");
    }
  }, [serverSearchable, session, toast]);

  // 快捷键：Ctrl+A 全选 / Ctrl+D 全不选（输入框/下拉内不拦截）
  useEffect(() => {
    if (session.state !== "success") return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || t?.isContentEditable) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        // Ctrl+F 打开搜索对话框（原版 `parse.py:644-646`）
        if (e.key === "f" || e.key === "F") { e.preventDefault(); setSearchOpen(true); }
        else if (e.key === "a" || e.key === "A") { e.preventDefault(); session.setAll(true); }
        else if (e.key === "d" || e.key === "D") { e.preventDefault(); session.setAll(false); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session.state, session]);

  return (
    <section className="page">
      {/* 顶部一行：输入框（带「粘贴并解析」与清空）+ **拆分按钮**（主：解析 / 下拉：批量解析）
          —— 对齐原版 parse.py:404-406（url_box + IndeterminateProgressSplitPushButton） */}
      <div className="parse-top">
        <div className="url-input-wrap">
          <input
            value={session.input}
            onChange={(e) => session.setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") doParse(); }}
            placeholder={typePlaceholder(session.parseType)}
          />
          <button type="button" className="in-input-btn" title={tr("粘贴并解析")} aria-label={tr("粘贴并解析")}
            onClick={async () => {
              try {
                const text = (await navigator.clipboard?.readText()) ?? "";
                if (!text.trim()) { toast(tr("剪贴板里没有内容"), "warn"); return; }
                session.setInput(text.trim());
                session.setParseType("auto");
                // setInput 之后立刻解析：doParse 读的是渲染快照，所以这里直接走 parseItemUrl
                await parseItemUrl(text.trim());
              } catch {
                toast(tr("读取剪贴板被拒绝，请手动粘贴"), "warn");
              }
            }}>
            <Icon name="paste" size={17} />
          </button>
          {session.input && (
            <button type="button" className="in-input-btn" title={tr("清空")} aria-label={tr("清空")} onClick={() => session.setInput("")}>
              <Icon name="x" size={16} />
            </button>
          )}
        </div>
        <select className="type-select" value={session.parseType} onChange={(e) => session.setParseType(e.target.value)} aria-label={tr("解析类型")}>
          <option value="auto">{tr("自动识别")}</option>
          <option value="video">{tr("视频")}</option>
          <option value="bangumi">番剧/电影</option>
          <option value="cheese">{tr("课程")}</option>
          <option value="audio">{tr("音频")}</option>
          <option value="space">UP 空间</option>
          <option value="favlist">{tr("收藏夹")}</option>
          <option value="watch_later">{tr("稍后再看")}</option>
          <option value="history">{tr("历史记录")}</option>
          <option value="popular">{tr("每周必看")}</option>
          <option value="list">合集/系列</option>
        </select>
        <div className="split-btn">
          <button type="button" className="btn primary parse-btn" disabled={session.state === "parsing"} onClick={() => void doParse()}>
            {session.state === "parsing" ? tr("解析中…") : tr("解析")}
          </button>
          <button type="button" className="btn primary split-caret" disabled={session.state === "parsing"}
            onClick={() => setSplitOpen((v) => !v)} aria-label={tr("更多解析方式")} title={tr("更多")}>
            <Icon name="chevD" size={15} />
          </button>
          {splitOpen && (
            <>
              <div className="ctx-layer" onClick={() => setSplitOpen(false)} />
              <div className="split-menu">
                <button type="button" className="ctx-item" onClick={() => { setSplitOpen(false); setBulkOpen(true); }}>{tr("批量解析")}</button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* 状态行：左「{分类}（已选择 N 项，共 M 项）」（原版 parse.py:590-594），
          右四个**图标**按钮：搜索 / 解析记录 / 批量选择 / 下载选项（原版 parse.py:408-414；原版这个按钮叫 Parse History=解析记录） */}
      <div className="parse-status">
        <span className="toolbar-label">
          {session.state === "success" ? (
            // 状态行逐字取原版 `item_count_label`：带占位符、各语言词序不同，必须整体翻译。
            // 原版是纯文本 QLabel，我们以前把数字加粗了 —— 去掉加粗，回到原版样式。
            <>{trp("{category_name}（已选择 {selected_count} 项，共 {total_count} 项）", { category_name: categoryLabel, selected_count: leaves.length, total_count: totalItems })}</>
          ) : session.state === "error" ? (
            <span className="danger">{tr("解析失败：")}{session.error}</span>
          ) : (
            <span className="muted">{tr("输入链接后点击解析")}</span>
          )}
        </span>
        <span className="spacer" />
        <button type="button" className="icon-btn" title={tr("搜索")} aria-label={tr("搜索")}
          disabled={session.state !== "success"} onClick={() => setSearchOpen(true)}>
          <Icon name="search" size={19} />
        </button>
        <button type="button" className="icon-btn" title={tr("解析记录")} aria-label={tr("解析记录")} onClick={() => setHistoryOpen(true)}>
          <Icon name="history" size={19} />
        </button>
        <button type="button" className="icon-btn" title={tr("批量选择")} aria-label={tr("批量选择")} disabled={session.state !== "success"} onClick={() => setBatchOpen(true)}>
          <Icon name="batch" size={19} />
        </button>
        <button type="button" className="icon-btn" title={tr("下载选项")} aria-label={tr("下载选项")} disabled={leaves.length === 0} onClick={() => openDialog(leaves)}>
          <Icon name="options" size={19} />
        </button>
      </div>

      {/* 翻页数 / 期数：仅解析前可调（我们保留的输入项，原版对应底部 Pager 与「自动解析分页」） */}
      {session.state !== "success" && (parsePages(session.parseType) || session.parseType === "popular") && (
        <div className="toolbar">
          {parsePages(session.parseType) && (
            <span className="pager-inline">
              <label className="small muted">{tr("翻页数")}</label>
              <input type="number" className="text-input" style={{ width: 64 }} min={1} max={100} value={session.autoPages} onChange={(e) => session.setAutoPages(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} />
            </span>
          )}
          {session.parseType === "popular" && (
            <span className="pager-inline">
              <label className="small muted">{tr("期数")}</label>
              <input type="number" className="text-input" style={{ width: 64 }} min={1} value={session.weekNum} onChange={(e) => session.setWeekNum(Math.max(1, Number(e.target.value) || 1))} />
            </span>
          )}
        </div>
      )}

      {session.state === "parsing" && (
        <div className="empty-state">
              {/* 解析中：用骨架行画出"结果即将出现"的形状（以前只转一个圈） */}
              <div className="sk-rows" aria-hidden="true">
                {[0, 1, 2, 3].map((i) => (
                  <div className="sk-row" key={i}>
                    <div className="sk sk-thumb" />
                    <div className="sk-lines"><div className="sk sk-line w80" /><div className="sk sk-line w40" /></div>
                  </div>
                ))}
              </div>
              <p>{tr("正在解析…")}</p>
            </div>
      )}
      {session.state === "success" && (
        <ParseTree
          onDownloadOne={(it) => openDialog([it])}
          onParseItem={(url) => void parseItemUrl(url)}
          onUpdateMediaInfo={(it) => openDialog([it])}
          onViewParts={setPartsItem}
          matchIds={matchSet}
          activeMatchId={matchIds[matchIndex] ?? null}
        />
      )}
      {session.state === "idle" && (
        <div className="empty-state">
          <h3>{tr("等待解析")}</h3>
          <p>粘贴 Bilibili 链接，解析出可下载的条目树（分P / 剧集 / 课程 / 列表）。</p>
        </div>
      )}

      {session.state === "success" && (
        <div className="parse-bottom">
          {/* 原版 bottom_layout：底部组件（搜索结果 / 分页）在左、下载按钮在右 */}
          <ParseSegment
            view={bottomView}
            onView={setBottomView}
            hasPager={pagination !== undefined}
            hasSearch={matchIds.length > 0 || searchKeyword !== ""}
            pager={pagination ? (
              <Pager
                page={session.page}
                totalPages={pagination.totalPages}
                totalItems={pagination.total}
                onPage={(n) => void parseAtPage(n, 1)}
                onAutoParse={() => setAutoOpen(true)}
                autoParseRef={autoParseBtnRef}
              />
            ) : null}
            search={searchKeyword !== "" ? {
              keyword: searchKeyword,
              count: matchIds.length,
              index: matchIndex,
              onPrev: () => gotoMatch(matchIndex - 1),
              onNext: () => gotoMatch(matchIndex + 1),
              onSelectAll: () => session.setNodeIdsChecked(new Set(matchIds), true),
              onClear: () => { setMatchIds([]); setMatchIndex(0); setSearchKeyword(""); },
            } : null}
          />
          <button type="button" className="btn primary" disabled={leaves.length === 0} onClick={doDownload}>{tr("下载所选项目")}</button>
        </div>
      )}

      {/* 「自动解析分页」（原版 AutoParseDialog）：范围二选一 + 解析间隔 + 两个勾选 */}
      <AutoParseDialog
        open={autoOpen}
        onClose={() => setAutoOpen(false)}
        totalPages={pagination?.totalPages ?? 1}
        currentPage={session.page}
        config={cfg}
        onPatchConfig={(p) => void saveConfig(p)}
        onStart={(from, to) => {
          const n = to - from + 1;
          session.setAutoPages(n);
          void parseAtPage(from, n, cfg?.behavior?.autoAddToDownloadList === true);
        }}
      />
      {/* 「自动解析分页」教学气泡（原版 `parse.py:70-76,233-245`）：
          结果有分页且总页数>1、没看过、也没开「自动显示此对话框」时，指向分页器上的自动解析按钮 */}
      <TeachingTip
        open={autoTipOpen}
        target={autoParseBtnRef.current}
        title={tr("自动解析分页")}
        content="点击此处可进行自动解析分页操作"
        tail="bottom"
        onClose={dismissAutoTip}
      />
      {/* 行号上界用「条目数」（= 叶子数 = 序号列的最大值），不是顶层节点数 */}
      <BatchSelectDialog open={batchOpen} onClose={() => setBatchOpen(false)} total={totalItems} onApply={(nums) => { session.setByIndices(new Set(nums)); setBatchOpen(false); }} />
      <BatchParseDialog open={bulkOpen} onClose={() => setBulkOpen(false)} onParsed={(urls, results, autoSelect) => { session.setInput(urls.join("\n")); session.setParseType("auto"); session.success(results); if (autoSelect) session.setAll(true); setBulkOpen(false); }} />
      <SearchDialog
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        serverSearchAvailable={serverSearchable}
        currentKeyword={searchKeyword}
        paginated={pagination !== undefined}
        onLocal={runLocalSearch}
        onServer={(kw) => void runServerSearch(kw)}
      />
      <ParseHistoryDialog open={historyOpen} onClose={() => setHistoryOpen(false)} />
      {/* 互动视频确认（原版 InteractiveVideoDialog）：确认后重新解析并 BFS 展开全部分支节点 */}
      <InteractiveVideoDialog
        open={interactiveOpen}
        {...(interactiveTitle !== undefined ? { title: interactiveTitle } : {})}
        onCancel={() => setInteractiveOpen(false)}
        onConfirm={() => { setInteractiveOpen(false); void doParse({ interactiveAll: true }); }}
      />
      {/* 分P视频列表（原版 MultiPartListsDialog；入口在行菜单「查看分P视频列表」） */}
      <MultiPartListsDialog
        open={partsItem !== null}
        item={partsItem}
        onClose={() => setPartsItem(null)}
        onDownload={(picked) => void downloadParts(picked)}
      />
      <DownloadOptionsDialog />
    </section>
  );
}


function BatchSelectDialog({ open, onClose, total, onApply }: {
  open: boolean; onClose: () => void;
  /** 叶子（可勾选行）总数 —— 序号列的最大值 */
  total: number;
  onApply: (nums: number[]) => void;
}) {
  const [text, setText] = useState("");
  const { toast } = useToast();
  /**
   * 解析行号串：三种失败分别给原版那三句（`batch_select.py:55-81`），
   * 逻辑在 `lib/batchSelect.ts`（纯函数、有单测）。
   * 原版**不校验上界**，所以这里只提示"有几个号超出范围、未命中"，不当成错误。
   */
  const apply = () => {
    const r = parseLineNumbers(text);
    if (!r.ok) { toast(r.message, "warn"); return; }
    const hit = r.numbers.filter((n) => n <= total).length;
    onApply(r.numbers);
    toast(
      hit === r.numbers.length
        ? `已按行号勾选 ${hit} 项`
        : `已按行号勾选 ${hit} 项（${r.numbers.length - hit} 个号超出范围，未命中）`,
      "ok",
    );
  };

  return (
    <Overlay open={open} onClose={onClose} size="sm" sheetOnMobile centerOnMobile>
        <div className="modal-head"><div className="modal-title">{tr("批量选择")}</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={tr("关闭")}><Icon name="x" size={18} /></button>
        </div>
        <div className="modal-body">
          <input className="text-input" style={{ width: "100%" }} value={text} autoFocus
            placeholder={tr("请输入行号，例如：1,3,5-10")}
            onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") apply(); }} />
          {/* 原版把 BATCH_SELECT_GUIDE 当输入框下方的提示标签（`batch_select.py:24`） */}
          <p className="muted small" style={{ marginTop: 10, whiteSpace: "pre-line" }}>按 Ctrl + A 全选，Ctrl + D 取消全选{"\n"}也可以按住 Shift 并点击以选择连续项目。</p>
          <p className="muted small" style={{ marginTop: 6 }}>行号 = 序号列里的数字（跨层级连续），当前最大 {total}。</p>
        </div>
        <div className="modal-foot">
          <div className="right">
            <button type="button" className="btn" onClick={onClose}>{tr("取消")}</button>
            <button type="button" className="btn primary" onClick={apply}>{tr("确定")}</button>
          </div>
        </div>
      </Overlay>
  );
}


function BatchParseDialog({ open, onClose, onParsed }: {
  open: boolean; onClose: () => void;
  onParsed: (urls: string[], results: ParseResult[], autoSelect: boolean) => void;
}) {
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [autoSelect, setAutoSelect] = useState(false);
  const [parsing, setParsing] = useState(false);
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const start = async () => {
    if (!lines.length) { toast(tr("请粘贴要解析的链接（每行一个）"), "warn"); return; }
    setParsing(true);
    const results: ParseResult[] = [];
    let ok = 0; let failed = 0;
    for (const url of lines) {
      try {
        const r = await parseUrl({ urls: [url] });
        if (r.results.length) { results.push(...r.results); ok += 1; }
        else failed += 1;
      } catch { failed += 1; }
    }
    setParsing(false);
    if (!results.length) { toast(tr("全部解析失败，请检查链接"), "err"); return; }
    if (failed) toast(`批量解析完成：成功 ${ok}，失败 ${failed}`, "warn");
    else toast(`批量解析完成：${ok} 条链接`, "ok");
    onParsed(lines, results, autoSelect);
  };
  return (
    <Overlay open={open} onClose={onClose} size="md" sheetOnMobile centerOnMobile>
        <div className="modal-head"><div className="modal-title">{tr("批量解析")}</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={tr("关闭")}><Icon name="x" size={18} /></button>
        </div>
        <div className="modal-body">
          <p className="muted small">粘贴视频/番剧等链接，每行一个；逐条解析，单条失败不影响其它。</p>
          <textarea className="text-input batch-textarea" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={"链接数：0\n每行一个链接，如 BV1xx411c7mD"} />
          <label className="batch-auto"><input type="checkbox" checked={autoSelect} onChange={(e) => setAutoSelect(e.target.checked)} /> 解析后自动全选（加入下载列表）</label>
        </div>
        <div className="modal-foot">
          <div className="muted small">共 {lines.length} 条链接</div>
          <div className="right">
            <button type="button" className="btn" onClick={onClose}>{tr("取消")}</button>
            <button type="button" className="btn primary" onClick={() => void start()} disabled={parsing}>{parsing ? tr("解析中…") : tr("开始解析")}</button>
          </div>
        </div>
      </Overlay>
  );
}


/**
 * 搜索对话框（原版 `dialog/misc/search.py`）。
 *
 * 三种形态：
 * 1. 接口支持服务端搜索（空间/收藏夹/历史/稍后再看且已登录）→ 多一个「搜索范围」二选一；
 * 2. 有分页但接口不支持搜索（合集等）→ 提示只能筛选当前页；
 * 3. 其余 → 只有关键词框。
 *
 * 服务端搜索允许留空（表示清除关键词、重新解析出完整内容）；本地筛选必须填关键词。
 */
function SearchDialog({ open, onClose, serverSearchAvailable, currentKeyword, paginated, onLocal, onServer }: {
  open: boolean;
  onClose: () => void;
  serverSearchAvailable: boolean;
  /** 当前已生效的关键词（对应原版 `current_search_keyword`），用于回显 */
  currentKeyword: string;
  /** 本次结果是否带分页（决定本地筛选是否覆盖得到全部内容） */
  paginated: boolean;
  onLocal: (keyword: string) => void;
  onServer: (keyword: string) => void;
}) {
  const { toast } = useToast();
  const [kw, setKw] = useState("");
  const [scope, setScope] = useState<"page" | "all">("page");

  // 打开时回显：已有关键词时默认继续用服务端搜索（原版 `search.py:57-61`）
  useEffect(() => {
    if (!open) return;
    setKw(currentKeyword);
    setScope(currentKeyword ? "all" : "page");
  }, [open, currentKeyword]);

  const useServer = serverSearchAvailable && scope === "all";

  const confirm = () => {
    const k = kw.trim();
    // 服务端搜索允许留空（= 清除关键词）；本地筛选必须有关键词
    if (!useServer && !k) { toast(tr("请输入搜索关键词"), "warn"); return; }
    if (useServer) onServer(k);
    else onLocal(k);
    onClose();
  };

  return (
    <Overlay open={open} onClose={onClose} size="sm" sheetOnMobile centerOnMobile>
        <div className="modal-head"><div className="modal-title">{tr("搜索")}</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={tr("关闭")}><Icon name="x" size={18} /></button>
        </div>
        <div className="modal-body">
          <input className="text-input" style={{ width: "100%" }} value={kw} autoFocus
            placeholder={tr("请输入关键词")}
            onChange={(e) => setKw(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") confirm(); }} />
          {serverSearchAvailable ? (
            <div className="search-scope">
              <div className="small muted" style={{ marginTop: 10 }}>{tr("搜索范围")}</div>
              <label className="radio-row">
                <input type="radio" name="search-scope" checked={scope === "page"} onChange={() => setScope("page")} />
                <span>{tr("仅筛选当前页")}</span>
              </label>
              <label className="radio-row">
                <input type="radio" name="search-scope" checked={scope === "all"} onChange={() => setScope("all")} />
                <span>{tr("搜索全部分页")}</span>
              </label>
            </div>
          ) : paginated ? (
            <p className="muted small" style={{ marginTop: 10 }}>{tr("只能筛选当前页，如需搜索全部内容，请先解析全部分页。")}</p>
          ) : null}
        </div>
        <div className="modal-foot">
          <div className="right">
            <button type="button" className="btn" onClick={onClose}>{tr("取消")}</button>
            <button type="button" className="btn primary" onClick={confirm}>{tr("确定")}</button>
          </div>
        </div>
      </Overlay>
  );
}
