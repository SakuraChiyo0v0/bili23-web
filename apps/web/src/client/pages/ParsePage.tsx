import { useCallback } from "react";
import { parseUrl, createTasks } from "../services/client";
import { useParseSession } from "../store/useParseSession";
import { useTasksStore } from "../store/useParseSession";
import { useToast } from "../lib/toast";
import { ParseTree } from "../components/ParseTree";

export function ParsePage() {
  const session = useParseSession();
  const tasksStore = useTasksStore();
  const { toast } = useToast();

  const doParse = useCallback(async () => {
    const input = session.input.trim();
    if (!input) {
      toast("请先输入链接或关键词", "warn");
      return;
    }
    session.start();
    try {
      const { results } = await parseUrl({ urls: [input] });
      if (!results.length) throw new Error("解析结果为空");
      session.success(results);
      toast(`解析完成，共 ${results.reduce((n, r) => n + r.items.length, 0)} 个条目`, "ok");
    } catch (e) {
      session.fail(e instanceof Error ? e.message : String(e));
      toast("解析失败：" + (e instanceof Error ? e.message : String(e)), "err");
    }
  }, [session, toast]);

  const doDownload = useCallback(async () => {
    const leaves = session.selectedLeaves();
    if (!leaves.length) {
      toast("请先勾选要下载的条目", "warn");
      return;
    }
    try {
      const { tasks, duplicates } = await createTasks(leaves.map((l) => l.id));
      tasksStore.setTasks(tasks);
      if (duplicates.length) toast(`已跳过 ${duplicates.length} 个重复项`, "warn");
      toast(`已创建 ${tasks.length} 个下载任务`, "ok");
    } catch (e) {
      toast("创建任务失败：" + (e instanceof Error ? e.message : String(e)), "err");
    }
  }, [session, tasksStore, toast]);

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
              placeholder="粘贴链接 / BV / av / ep / ss / md / 收藏夹 / 空间…"
            />
          </div>
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
    </section>
  );
}
