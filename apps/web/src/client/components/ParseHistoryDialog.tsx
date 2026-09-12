import { useEffect, useState } from "react";
import { Icon } from "../lib/icons";
import { listParseHistory, deleteParseHistory, parseUrl, type ParseHistoryItem } from "../services/client";
import { useParseSession } from "../store/useParseSession";
import { useToast } from "../lib/toast";
import type { RouteId } from "../lib/routes";
import { CATEGORY_LABEL } from "../lib/parseTree";
import { t as tr, trp } from "../lib/i18n";

/**
 * 解析记录弹窗（原版 `gui/dialog/misc/parse_history.py`）。
 *
 * 位置对齐原版：它是**解析页工具条上的一个按钮**（`gui/interface/parse.py` 的
 * `history_btn` → `ParseHistoryDialog`），不是导航栏的一项 —— 所以这个组件由
 * `ParsePage` 使用，而不是 `Layout`。
 *
 * 形态也对齐原版：标题「解析记录」+ 提示「仅保留最近 100 条记录」+ 工具条「清除记录」+
 * **五列表格**（序号 / 标题 / 类型 / 解析时间 / 操作，每行「解析」「删除」两个按钮）。
 */
export function ParseHistoryDialog({ open, onClose, onNavigate }: {
  open: boolean; onClose: () => void; /** 本弹窗挂在解析页上，跳转是可选的（原版点"解析"即刷新当前页） */
  onNavigate?: (id: RouteId) => void;
}) {
  const { toast } = useToast();
  const parseSession = useParseSession();
  const [items, setItems] = useState<ParseHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");

  useEffect(() => { if (open) void refresh(); /* eslint-disable-next-line */ }, [open]);

  const refresh = async () => {
    setLoading(true); setError("");
    try {
      const { history } = await listParseHistory();
      setItems(history);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  };

  const openItem = async (item: ParseHistoryItem) => {
    setBusyId(item.id);
    try {
      const r = await parseUrl({ urls: [item.url] });
      const results = r.results;
      if (!results.length) throw new Error("解析结果为空");
      parseSession.setInput(item.url);
      parseSession.setParseType("auto");
      parseSession.start();
      parseSession.success(results);
      toast("已重新解析：" + item.title, "ok");
      onClose();
      onNavigate?.("parse");
    } catch (e) {
      toast("解析失败：" + (e instanceof Error ? e.message : String(e)), "err");
    } finally { setBusyId(null); }
  };

  const remove = async (id: number) => {
    try {
      await deleteParseHistory(id);
      setItems((cur) => cur.filter((x) => x.id !== id));
      toast(tr("已删除该条解析记录"), "ok");
    } catch (e) {
      toast("删除失败：" + (e instanceof Error ? e.message : String(e)), "err");
    }
  };

  /** 「清除记录」：原版工具条上的一键清空（我们逐条删，接口侧没有批量删除） */
  const clearAll = async () => {
    if (items.length === 0) return;
    const ids = items.map((x) => x.id);
    await Promise.all(ids.map((id) => deleteParseHistory(id).catch(() => null)));
    setItems([]);
    toast(trp("已清除 {count} 条解析记录", { count: ids.length }), "ok");
  };

  if (!open) return null;

  return (
    <div className="overlay sheet-on-mobile center-mobile" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal md" role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className="modal-title">{tr("解析记录")}</div>
          <button type="button" className="icon-btn" onClick={() => { setItems([]); onClose(); }} aria-label={tr("关闭")}><Icon name="x" size={18} /></button>
        </div>
        <div className="modal-body">
          {/* 原版 `parse_history.py:24-131`：顶部一句"仅保留最近 100 条记录"（后端确实按 100 条裁剪） */}
          <p className="muted small" style={{ marginBottom: 8 }}>{tr("仅保留最近 100 条记录")}</p>
          {error && <p className="danger small">加载失败：{error}</p>}
          {items.length === 0 && !loading && <p className="muted small center">{tr("暂无解析历史")}</p>}
          {items.length > 0 && (
            <div className="history-table">
              <div className="history-head">
                <span>{tr("序号")}</span><span>{tr("标题")}</span><span>{tr("类型")}</span><span>{tr("解析时间")}</span><span>{tr("操作")}</span>
              </div>
              {items.map((item, i) => (
                <div key={item.id} className="history-tr">
                  <span className="muted">{i + 1}</span>
                  <span className="history-title-cell" title={item.url}>{item.title || item.url}</span>
                  <span className="muted">{tr(CATEGORY_LABEL[item.type] ?? item.type)}</span>
                  <span className="muted">{new Date(item.createdAt * 1000).toLocaleString()}</span>
                  <span className="history-ops">
                    <button type="button" className="btn sm ghost" disabled={busyId === item.id} onClick={() => void openItem(item)}>{busyId === item.id ? tr("解析中…") : tr("解析")}</button>
                    <button type="button" className="btn sm ghost dangerous" onClick={() => void remove(item.id)}>{tr("删除")}</button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn ghost" onClick={() => void clearAll()} disabled={items.length === 0}>{tr("清除记录")}</button>
          <div className="right">
            <button type="button" className="btn ghost" onClick={() => void refresh()}>{loading ? tr("加载中…") : tr("刷新")}</button>
            <button type="button" className="btn" onClick={() => { setItems([]); onClose(); }}>{tr("关闭")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
