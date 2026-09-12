import { useState } from "react";
import { Icon } from "../lib/icons";
import { t as tr } from "../lib/i18n";

/**
 * 字幕语言选择 —— 原版 `SubtitlesLanguageDialog`：
 * 「只下载指定语言」开关 + 语言多选（可选语言与 B 站字幕接口一致）。
 *
 * 原来它内联在「下载选项」弹窗里；设置页也要用同一份（全局默认），
 * 所以抽出来共用 —— 避免两处各写一份、日后漂移。
 */
export const SUBTITLE_LANGS = [
  { v: "zh-CN", label: "简体中文" }, { v: "zh-TW", label: "繁体中文" },
  { v: "en", label: "英语" }, { v: "ja", label: "日语" },
  { v: "ko", label: "韩语" }, { v: "ai-zh", label: "AI 中文" },
  { v: "ai-en", label: "AI 英文" },
];

export interface SubtitleLanguageValue {
  downloadSpecified: boolean;
  specifiedLanguages: string[];
}

export function SubtitleLanguageDialog({ open, onClose, selection, onChange }: {
  open: boolean;
  onClose: () => void;
  selection: SubtitleLanguageValue;
  onChange: (v: SubtitleLanguageValue) => void;
}) {
  const [specified, setSpecified] = useState<boolean>(selection.downloadSpecified);
  const [langs, setLangs] = useState<string[]>(selection.specifiedLanguages);
  if (!open) return null;
  const toggleLang = (v: string) => setLangs((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]));
  return (
    <div className="overlay sheet-on-mobile center-mobile" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal sm">
        <div className="modal-head"><div className="modal-title">{tr("字幕语言")}</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={tr("关闭")}><Icon name="x" size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="dl-toggle"><span>{tr("只下载指定语言")}</span>
            <input type="checkbox" className="switch" checked={specified} onChange={(e) => setSpecified(e.target.checked)} />
          </div>
          {specified && (
            <div className="lang-grid">
              {SUBTITLE_LANGS.map((l) => (
                <label key={l.v} className="lang-chip"><input type="checkbox" checked={langs.includes(l.v)}
                  onChange={() => toggleLang(l.v)} /> {l.label}</label>
              ))}
            </div>
          )}
          {specified && langs.length === 0 && <div className="muted small">{tr("请至少选择一种语言")}</div>}
        </div>
        <div className="modal-foot">
          <div className="right">
            <button type="button" className="btn" onClick={onClose}>{tr("取消")}</button>
            <button type="button" className="btn primary"
              onClick={() => { onChange({ downloadSpecified: specified, specifiedLanguages: specified ? langs : [] }); onClose(); }}>{tr("确定")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
