import { useState } from "react";
import { useToast } from "../lib/toast";
import { t as tr } from "../lib/i18n";

const DEFAULT_CN_CDN_HOSTS = [
  "https://upos-sz-mirrorali.bilivideo.com",
  "https://upos-sz-mirrorcos.bilivideo.com",
  "https://upos-sz-mirrorks.bilivideo.com",
];

/** 海外默认节点（对齐桌面 ov_cdn_server_list 的 3 个：AKAMAI / ALIYUN / TENCENT） */
const DEFAULT_OV_CDN_HOSTS = [
  "https://upos-hz-mirrorakam.akamaized.net",
  "https://upos-sz-mirroraliov.bilivideo.com",
  "https://upos-sz-mirrorcosov.bilivideo.com",
];

/**
 * CDN 节点编辑器：大陆 / 海外两套节点各自独立编辑（对齐桌面 cn/ov_cdn_server_list）。
 * 改前只有一个列表，两个页签共用、切换只是换高亮，海外页签改的是大陆同一份数据。
 */
export function CdnEditor({
  open, onClose, hosts, ovHosts, onChange,
}: {
  open: boolean; onClose: () => void; hosts: string[]; ovHosts: string[];
  onChange: (hosts: string[], ovHosts: string[]) => void;
}) {
  const { toast } = useToast();
  const [cn, setCn] = useState<string[]>(hosts);
  const [ov, setOv] = useState<string[]>(ovHosts);
  const [draft, setDraft] = useState("");
  const [tab, setTab] = useState<"mainland" | "overseas">("mainland");

  if (!open) return null;

  const items = tab === "mainland" ? cn : ov;
  const setItems = (next: string[]) => (tab === "mainland" ? setCn(next) : setOv(next));

  const add = () => {
    const v = draft.trim();
    if (!v) { toast(tr("请输入节点地址"), "warn"); return; }
    if (!/^https?:\/\//.test(v)) { toast(tr("地址需以 http(s):// 开头"), "warn"); return; }
    setItems([...items, v]); setDraft("");
  };
  const remove = (i: number) => setItems(items.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items]; [next[i], next[j]] = [next[j]!, next[i]!]; setItems(next);
  };
  const save = () => onChange(cn, ov);
  /** 恢复默认：按当前页签各自的默认列表，海外不会被重置成国内节点 */
  const reset = () => setItems(tab === "mainland" ? [...DEFAULT_CN_CDN_HOSTS] : [...DEFAULT_OV_CDN_HOSTS]);

  return (
    <div className="overlay sheet-on-mobile center-mobile" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal md cdn-editor">
        <div className="modal-head">
          <div className="modal-title">CDN 节点</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={tr("关闭")}>
            <svg className="ico" viewBox="0 0 24 24" width={18} height={18}><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="login-tabs">
          <button className={`login-tab${tab === "mainland" ? " active" : ""}`} onClick={() => setTab("mainland")}>{tr("大陆")}</button>
          <button className={`login-tab${tab === "overseas" ? " active" : ""}`} onClick={() => setTab("overseas")}>{tr("海外")}</button>
        </div>
        <div className="modal-body cdn-body">
          <div className="cdn-add-row">
            <input className="text-input" style={{ flex: 1 }} value={draft} placeholder="https://upos-sz-mirrorali.bilivideo.com" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
            <button type="button" className="btn sm primary" onClick={add}>{tr("添加")}</button>
          </div>
          <div className="cdn-list">
            {items.map((h, i) => (
              <div key={h + i} className="cdn-row">
                <code className="cdn-host">{h}</code>
                <span className="cdn-ops">
                  <button type="button" className="btn sm ghost" onClick={() => move(i, -1)}>↑</button>
                  <button type="button" className="btn sm ghost" onClick={() => move(i, 1)}>↓</button>
                  <button type="button" className="btn sm ghost dangerous" onClick={() => remove(i)}>{tr("删除")}</button>
                </span>
              </div>
            ))}
            {items.length === 0 && <p className="muted small center">{tr("暂无节点")}</p>}
          </div>
          <div className="modal-foot">
            <button type="button" className="btn ghost" onClick={reset}>{tr("恢复默认")}</button>
            <div className="right">
              <button type="button" className="btn" onClick={onClose}>{tr("取消")}</button>
              <button type="button" className="btn primary" onClick={save}>{tr("保存")}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}