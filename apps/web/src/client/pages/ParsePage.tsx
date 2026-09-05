import { useCallback, useEffect, useState } from "react";
import { createTasks, parseUrl } from "../services/client";
import type { ParseResult } from "../services/types";
import { useDownloadOptions } from "../store/useDownloadOptions";
import { DownloadOptionsDialog } from "../components/DownloadOptionsDialog";
import { useParseSession } from "../store/useParseSession";
import { useSettingsStore } from "../store/useSettingsStore";
import { useToast } from "../lib/toast";
import { ParseTree } from "../components/ParseTree";
import { Icon } from "../lib/icons";

export function ParsePage() {
  const session = useParseSession();
  const [batchOpen, setBatchOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [serverSearchOpen, setServerSearchOpen] = useState(false);
  const { toast } = useToast();
  const parsePages = (t: string) => ["space","favlist","history","watch_later","list"].includes(t);
  const serverSearchable = ["space","favlist","history","watch_later"].includes(session.parseType);

  const typePlaceholder = (t: string) => { if (t === "auto") return "粘贴链接 / BV / av / ep / ss / md / 收藏夹 / 空间…"; if (t === "space") return "UP 主 UID 或主页链接"; if (t === "favlist") return "收藏夹链接 / 列表 ID"; if (t === "watch_later") return "（自动）稍后再看"; if (t === "history") return "（自动）历史记录"; if (t === "popular") return "每周必看（可填期数）"; return "粘贴相应分类的链接"; };

  const doParse = useCallback(async () => {
    const input = session.input.trim();
    if (!input) {
      toast("请先输入链接或关键词", "warn");
      return;
    }
    session.start();
    try {
      let results;
      if (session.parseType === "auto") {
        const urls = input.split(/\r?\n|,|;/).map((s) => s.trim()).filter(Boolean);
        const r = await parseUrl({ urls });
        results = r.results;
      } else {
        const r = await parseUrl({ type: session.parseType, query: input, ...(parsePages(session.parseType) ? { pages: session.autoPages } : {}) });
        results = r.results;
      }
      if (!results.length) throw new Error("解析结果为空");
      session.success(results);
      toast(`解析完成，共 ${results.reduce((n, r) => n + r.items.length, 0)} 个条目`, "ok");
    } catch (e) {
      session.fail(e instanceof Error ? e.message : String(e));
      toast("解析失败：" + (e instanceof Error ? e.message : String(e)), "err");
    }
  }, [session, toast]);

  const { openDialog } = useDownloadOptions();
  const cfg = useSettingsStore((st) => st.config);
  const doDownload = useCallback(async () => {
    const leaves = session.selectedLeaves();
    if (!leaves.length) { toast("请先勾选要下载的条目", "warn"); return; }
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
      const { tasks } = await createTasks(ids, options);
      toast(`已创建 ${tasks.length} 个下载任务`, "ok");
    } catch (e) {
      const err = e as Error & { code?: string; duplicates?: Array<{ itemId: string; title: string }> };
      if (err.code === "DUPLICATE" || (err.duplicates && err.duplicates.length)) {
        toast(`已跳过 ${err.duplicates?.length ?? ids.length} 个重复项`, "warn");
      } else {
        toast("创建任务失败：" + (e instanceof Error ? e.message : String(e)), "err");
      }
    }
  }, [session, cfg, openDialog, toast]);


  const leaves = session.selectedLeaves();

  // 快捷键：Ctrl+A 全选 / Ctrl+D 全不选（输入框/下拉内不拦截）
  useEffect(() => {
    if (session.state !== "success") return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || t?.isContentEditable) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        if (e.key === "a" || e.key === "A") { e.preventDefault(); session.setAll(true); }
        else if (e.key === "d" || e.key === "D") { e.preventDefault(); session.setAll(false); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session.state, session]);

  return (
    <section className="page">
      <div className="panel parse-card">
        <div className="url-row">
          <div className="url-input-wrap">
            <input
              value={session.input}
              onChange={(e) => session.setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") doParse(); }}
              placeholder={typePlaceholder(session.parseType)}
            />
          </div>
          <select className="type-select" value={session.parseType} onChange={(e) => session.setParseType(e.target.value)}>
            <option value="auto">自动识别</option>
            <option value="video">视频</option>
            <option value="bangumi">番剧/电影</option>
            <option value="cheese">课程</option>
            <option value="audio">音频</option>
            <option value="space">UP 空间</option>
            <option value="favlist">收藏夹</option>
            <option value="watch_later">稍后再看</option>
            <option value="history">历史记录</option>
            <option value="popular">每周必看</option>
            <option value="list">合集/系列</option>
          </select>
          <button type="button" className="btn primary parse-btn" disabled={session.state === "parsing"} onClick={doParse}>
            {session.state === "parsing" ? "解析中…" : "解析"}
          </button>
          <button type="button" className="btn parse-btn-ghost" onClick={() => setBulkOpen(true)} disabled={session.state === "parsing"}>批量解析</button>
        </div>

        <div className="toolbar">
          {parsePages(session.parseType) && session.state !== "success" && (
            <span className="pager-inline">
              <label className="small muted">翻页数</label>
              <input type="number" className="text-input" style={{ width: 64 }} min={1} max={100} value={session.autoPages} onChange={(e) => session.setAutoPages(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} />
            </span>
          )}
          <span className="toolbar-label">
            {session.state === "success" ? (
              <>共 <b>{leaves.length}</b> 项已选 / 全量 <b>{session.results.reduce((n, r) => n + r.items.length, 0)}</b></>
            ) : session.state === "error" ? (
              <span className="muted">解析失败：{session.error}</span>
            ) : (
              <span className="muted">输入链接后点击解析</span>
            )}
          </span>
          {session.state === "success" && (
            <>
              <span className="toolbar-ops">
                {serverSearchable && <button type="button" className="btn sm" onClick={() => setServerSearchOpen(true)}>站内搜索…</button>}
                <button type="button" className="btn sm" onClick={() => session.setAll(true)} title="Ctrl+A">全选</button>
                <button type="button" className="btn sm" onClick={() => session.invertAll()} title="反选">反选</button>
                <button type="button" className="btn sm" onClick={() => session.setAll(false)} title="Ctrl+D">全不选</button>
                <button type="button" className="btn sm ghost" onClick={() => setBatchOpen(true)}>批量选择</button>
                <button type="button" className="btn sm ghost" onClick={() => session.expandAll(true)}>展开</button>
                <button type="button" className="btn sm ghost" onClick={() => session.expandAll(false)}>收起</button>
                <button type="button" className="btn sm ghost" onClick={session.reset}>清空</button>
              </span>
            </>
          )}
        </div>
      </div>

      {session.state === "parsing" && (
        <div className="empty-state"><span className="spinner" /><p>正在解析…</p></div>
      )}
      {session.state === "success" && <ParseTree onDownloadOne={(it) => openDialog([it])} />}
      {session.state === "idle" && (
        <div className="empty-state">
          <h3>等待解析</h3>
          <p>粘贴 Bilibili 链接，解析出可下载的条目树（分P / 剧集 / 课程 / 列表）。</p>
        </div>
      )}

      {session.state === "success" && (
        <div className="parse-bottom">
          <button type="button" className="btn primary" disabled={leaves.length === 0} onClick={doDownload}>
            下载选中项（{leaves.length}）
          </button>
        </div>
      )}
      <BatchSelectDialog open={batchOpen} onClose={() => setBatchOpen(false)} total={session.tree.length} onApply={(nums) => { session.setByIndices(new Set(nums)); setBatchOpen(false); }} />
      <BatchParseDialog open={bulkOpen} onClose={() => setBulkOpen(false)} onParsed={(urls, results, autoSelect) => { session.setInput(urls.join("\n")); session.setParseType("auto"); session.success(results); if (autoSelect) session.setAll(true); setBulkOpen(false); }} />
      <ServerSearchDialog open={serverSearchOpen} onClose={() => setServerSearchOpen(false)} parseType={session.parseType} query={session.input} onDone={(results) => { session.success(results); setServerSearchOpen(false); }} />
      <DownloadOptionsDialog />
    </section>
  );
}


function BatchSelectDialog({ open, onClose, total, onApply }: {
  open: boolean; onClose: () => void; total: number; onApply: (nums: number[]) => void;
}) {
  const [text, setText] = useState("");
  const { toast } = useToast();
  if (!open) return null;
  const parseNums = (): number[] | null => {
    const out: number[] = [];
    const parts = text.trim().split(/[,，;；\s]+/).filter(Boolean);
    for (const part of parts) {
      const m = /^(\d+)\s*-\s*(\d+)$/.exec(part) || /^(\d+)\.\.(\d+)$/.exec(part);
      if (m) {
        const a = Number(m[1]); const b = Number(m[2]);
        if (a < 1 || b < a || b > total) return null;
        for (let i = a; i <= b; i++) out.push(i);
        continue;
      }
      const n = Number(part);
      if (!Number.isInteger(n) || n < 1 || n > total) return null;
      out.push(n);
    }
    return out.length ? out : null;
  };
  const apply = () => {
    const nums = parseNums();
    if (!nums) { toast("格式无效：请输入 1-" + total + " 的行号，如 1,3,5-10", "warn"); return; }
    onApply([...new Set(nums)]);
    toast("已按行号勾选 " + new Set(nums).size + " 项", "ok");
  };
  return (
    <div className="overlay sheet-on-mobile center-mobile" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal sm">
        <div className="modal-head"><div className="modal-title">批量选择（按行号）</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭"><Icon name="x" size={18} /></button>
        </div>
        <div className="modal-body">
          <p className="muted small">当前共 {total} 项。输入要勾选的行号，支持 1、3、5-10 这类范围（含分P/合集按整组勾选）。</p>
          <input className="text-input" style={{ width: "100%", marginTop: 8 }} value={text} onChange={(e) => setText(e.target.value)} placeholder={"如 1,3,5-10（1-" + total + "）"} onKeyDown={(e) => { if (e.key === "Enter") apply(); }} autoFocus />
        </div>
        <div className="modal-foot">
          <div className="right">
            <button type="button" className="btn" onClick={onClose}>取消</button>
            <button type="button" className="btn primary" onClick={apply}>勾选</button>
          </div>
        </div>
      </div>
    </div>
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
  if (!open) return null;
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const start = async () => {
    if (!lines.length) { toast("请粘贴要解析的链接（每行一个）", "warn"); return; }
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
    if (!results.length) { toast("全部解析失败，请检查链接", "err"); return; }
    if (failed) toast(`批量解析完成：成功 ${ok}，失败 ${failed}`, "warn");
    else toast(`批量解析完成：${ok} 条链接`, "ok");
    onParsed(lines, results, autoSelect);
  };
  return (
    <div className="overlay sheet-on-mobile center-mobile" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal md">
        <div className="modal-head"><div className="modal-title">批量解析</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭"><Icon name="x" size={18} /></button>
        </div>
        <div className="modal-body">
          <p className="muted small">粘贴视频/番剧等链接，每行一个；逐条解析，单条失败不影响其它。</p>
          <textarea className="text-input batch-textarea" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={"链接数：0\n每行一个链接，如 BV1xx411c7mD"} />
          <label className="batch-auto"><input type="checkbox" checked={autoSelect} onChange={(e) => setAutoSelect(e.target.checked)} /> 解析后自动全选（加入下载列表）</label>
        </div>
        <div className="modal-foot">
          <div className="muted small">共 {lines.length} 条链接</div>
          <div className="right">
            <button type="button" className="btn" onClick={onClose}>取消</button>
            <button type="button" className="btn primary" onClick={() => void start()} disabled={parsing}>{parsing ? "解析中…" : "开始解析"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}


function ServerSearchDialog({ open, onClose, parseType, query, onDone }: {
  open: boolean; onClose: () => void; parseType: string; query: string;
  onDone: (results: ParseResult[]) => void;
}) {
  const { toast } = useToast();
  const [kw, setKw] = useState("");
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  const search = async () => {
    const k = kw.trim();
    if (!k) { toast("请输入搜索关键词", "warn"); return; }
    setBusy(true);
    try {
      // 服务端搜索当前收藏夹/空间/历史/稍后再看（接口带 keyword 会全量搜，翻页自动聚合）
      const r = await parseUrl({ type: parseType as "space" | "favlist" | "history" | "watch_later", query, keyword: k });
      if (!r.results.length) throw new Error("没有匹配结果");
      toast(`站内搜索“${k}”完成`, "ok");
      onDone(r.results);
    } catch (e) {
      toast("搜索失败：" + (e instanceof Error ? e.message : String(e)), "err");
    } finally { setBusy(false); }
  };
  return (
    <div className="overlay sheet-on-mobile center-mobile" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal sm">
        <div className="modal-head"><div className="modal-title">站内搜索</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭"><Icon name="x" size={18} /></button>
        </div>
        <div className="modal-body">
          <p className="muted small">在已解析的“{parseType}”中按关键词搜索全部条目（服务端搜索，自动覆盖所有页）。</p>
          <input className="text-input" style={{ width: "100%", marginTop: 8 }} value={kw} onChange={(e) => setKw(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void search(); }} placeholder="关键词" autoFocus />
        </div>
        <div className="modal-foot">
          <div className="right">
            <button type="button" className="btn" onClick={onClose}>取消</button>
            <button type="button" className="btn primary" onClick={() => void search()} disabled={busy}>{busy ? "搜索中…" : "搜索"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
