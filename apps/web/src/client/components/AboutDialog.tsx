import { useState } from "react";
import { Icon } from "../lib/icons";
import { TermsPanel } from "./TermsPanel";
import { t as tr } from "../lib/i18n";

/**
 * 「关于」弹窗。
 *
 * 原版是导航栏右下角的「关于」项，点开一个飞出层（`main_window.on_about_click`，
 * 不可选中）。Web 端用居中弹窗承载同一份内容（展示方式一致、承载形态可变）。
 */
export function AboutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [showTerms, setShowTerms] = useState(false);
  if (!open) return null;
  return (
    <div className="overlay sheet-on-mobile" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal sm" role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className="modal-title">关于 Bili23 Web</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={tr("关闭")}>
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="modal-body center">
          <div className="about-logo">B</div>
          <h3>Bili23 Web</h3>
          <p className="muted small">桌面版 Bili23-Downloader 的 1:1 Web 复刻</p>
          <p className="small muted">信息架构 / 交互 1:1 对齐原版 PyQt 客户端，Web 化视觉与响应式增强。<br />Web 版 · 2026-09</p>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn ghost" onClick={() => setShowTerms((s) => !s)}>{tr("使用协议")}</button>
          <div className="right">
            <button type="button" className="btn" onClick={onClose}>{tr("关闭")}</button>
          </div>
        </div>
      </div>
      {showTerms && (
        <div className="overlay sheet-on-mobile center-mobile" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowTerms(false); }}>
          <div className="modal md">
            <div className="modal-head">
              <div className="modal-title">{tr("使用协议")}</div>
              <button type="button" className="icon-btn" onClick={() => setShowTerms(false)} aria-label={tr("关闭")}><Icon name="x" size={18} /></button>
            </div>
            <div className="modal-body"><TermsPanel /></div>
            <div className="modal-foot"><div className="right"><button type="button" className="btn" onClick={() => setShowTerms(false)}>{tr("关闭")}</button></div></div>
          </div>
        </div>
      )}
    </div>
  );
}
