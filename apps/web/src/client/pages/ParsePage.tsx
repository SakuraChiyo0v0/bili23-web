import { useCallback } from "react";
import { parseUrl } from "../services/client";
import { useDownloadOptions } from "../store/useDownloadOptions";
import { DownloadOptionsDialog } from "../components/DownloadOptionsDialog";
import { useParseSession } from "../store/useParseSession";
import { useToast } from "../lib/toast";
import { ParseTree } from "../components/ParseTree";

export function ParsePage() {
  const session = useParseSession();
  const { toast } = useToast();
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
        const r = await parseUrl({ type: session.parseType, query: input });
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
  const doDownload = useCallback(() => {
    const leaves = session.selectedLeaves();
    if (!leaves.length) { toast("请先勾选要下载的条目", "warn"); return; }
    openDialog(leaves);
  }, [session, openDialog, toast]);


  const leaves = session.selectedLeaves();

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
        </div>

        <div className="toolbar">
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
              <button type="button" className="btn sm" onClick={() => session.setAll(true)}>全选</button>
              <button type="button" className="btn sm" onClick={() => session.setAll(false)}>全不选</button>
              <button type="button" className="btn sm ghost" onClick={session.reset}>清空</button>
            </>
          )}
        </div>
      </div>

      {session.state === "parsing" && (
        <div className="empty-state"><span className="spinner" /><p>正在解析…</p></div>
      )}
      {session.state === "success" && <ParseTree />}
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
      <DownloadOptionsDialog />
    </section>
  );
}
