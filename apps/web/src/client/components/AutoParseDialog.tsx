import { useEffect, useState } from "react";
import { useToast } from "../lib/toast";
import type { AppConfig, AppConfigPatch } from "../services/types";
import { t as tr } from "../lib/i18n";

/**
 * 「自动解析分页」对话框（原版 `gui/dialog/misc/auto_parse.py`）。
 *
 * 逐项对齐：说明文案 + 范围二选一（解析全部分页 / 仅解析第 X 页到第 Y 页，From/To 联动禁用）
 * + 解析间隔（0.1–15.0 秒）+ 两个勾选（每页后自动加入下载列表 / 自动显示此对话框）
 * + 风控警告 + 「开始解析」按钮 + 「起始页码不能大于结束页码」校验。
 *
 * 三个设置**确定与取消都会写回**（原版 `accept()` 与 `reject()` 都调 `save_config()`）。
 */
export function AutoParseDialog({ open, onClose, totalPages, currentPage, config, onPatchConfig, onStart }: {
  open: boolean;
  onClose: () => void;
  totalPages: number;
  currentPage: number;
  config?: AppConfig;
  onPatchConfig: (p: AppConfigPatch) => void;
  /** 开始解析：起始页 + 结束页（含）+ 是否解析完自动加入下载列表 */
  onStart: (startPage: number, endPage: number) => void;
}) {
  const { toast } = useToast();
  const [allPages, setAllPages] = useState(true);
  const [startPage, setStartPage] = useState(currentPage);
  const [endPage, setEndPage] = useState(totalPages);

  const interval = config?.behavior?.autoParseInterval ?? 2;
  const autoAdd = config?.behavior?.autoAddToDownloadList ?? false;
  const autoShow = config?.behavior?.showAutoParseDialog ?? false;

  // 每次打开按当前页/总页数重置范围（原版构造时就 setValue(current_page/total_pages)）
  useEffect(() => {
    if (!open) return;
    setAllPages(true);
    setStartPage(currentPage);
    setEndPage(totalPages);
  }, [open, currentPage, totalPages]);

  if (!open) return null;

  const confirm = () => {
    const from = allPages ? currentPage : startPage;
    const to = allPages ? totalPages : endPage;
    if (from > to) {
      // 原版：标题「无效范围」/ 正文「起始页码不能大于结束页码」
      toast(tr("无效范围：起始页码不能大于结束页码"), "warn");
      return;
    }
    onStart(from, to);
    onClose();
  };

  return (
    <div className="overlay sheet-on-mobile center-mobile" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal sm" role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className="modal-title">{tr("自动解析分页")}</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={tr("关闭")}>
            <svg className="ico" viewBox="0 0 24 24" width={18} height={18}><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="modal-body">
          <p className="muted small">{tr("请选择解析范围和后续处理方式")}</p>
          <div className="search-scope">
            <label className="radio-row">
              <input type="radio" name="auto-parse-range" checked={allPages} onChange={() => setAllPages(true)} />
              <span>{tr("解析全部分页")}</span>
            </label>
            <label className="radio-row">
              <input type="radio" name="auto-parse-range" checked={!allPages} onChange={() => setAllPages(false)} />
              <span>仅解析第 X 页到第 Y 页</span>
            </label>
            <div className="auto-parse-range">
              <span className={allPages ? "muted" : ""}>{tr("从")}</span>
              <input type="number" className="text-input" style={{ width: 88 }} min={1} max={totalPages}
                value={allPages ? currentPage : startPage} disabled={allPages}
                onChange={(e) => setStartPage(Math.max(1, Math.min(totalPages, Number(e.target.value) || 1)))} />
              <span className={allPages ? "muted" : ""}>{tr("到")}</span>
              <input type="number" className="text-input" style={{ width: 88 }} min={1} max={totalPages}
                value={allPages ? totalPages : endPage} disabled={allPages}
                onChange={(e) => setEndPage(Math.max(1, Math.min(totalPages, Number(e.target.value) || 1)))} />
            </div>
          </div>
          <div className="auto-parse-interval">
            <span>{tr("解析间隔")}</span>
            <input type="number" className="text-input" style={{ width: 88 }} min={0.1} max={15} step={0.1}
              value={interval}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (!Number.isFinite(v)) return;
                onPatchConfig({ behavior: { autoParseInterval: Math.min(15, Math.max(0.1, v)) } });
              }} />
            <span className="muted">{tr("秒")}</span>
          </div>
          <label className="check-row">
            <input type="checkbox" checked={autoAdd}
              onChange={(e) => onPatchConfig({ behavior: { autoAddToDownloadList: e.target.checked } })} />
            <span>{tr("解析每页后自动加入下载列表")}</span>
          </label>
          <label className="check-row">
            <input type="checkbox" checked={autoShow}
              onChange={(e) => onPatchConfig({ behavior: { showAutoParseDialog: e.target.checked } })} />
            <span>{tr("自动显示此对话框")}</span>
          </label>
          <p className="small warn-text">{tr("警告：由于B站风控机制，分页过多、频率过快可能导致解析失败，并封禁IP，请谨慎使用")}</p>
        </div>
        <div className="modal-foot">
          <div className="right">
            <button type="button" className="btn" onClick={onClose}>{tr("取消")}</button>
            <button type="button" className="btn primary" onClick={confirm}>{tr("开始解析")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
