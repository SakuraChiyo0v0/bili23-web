import { useState } from "react";
import { useToast } from "../lib/toast";

const DEFAULT_CDN_HOSTS = [
  "https://upos-sz-mirrorali.bilivideo.com",
  "https://upos-sz-mirrorcos.bilivideo.com",
  "https://upos-sz-mirrorks.bilivideo.com",
];

export function CdnEditor({
  open, onClose, hosts, onChange,
}: {
  open: boolean; onClose: () => void; hosts: string[]; onChange: (hosts: string[]) => void;
}) {
  const { toast } = useToast();
  const [items, setItems] = useState<string[]>(hosts);
  const [draft, setDraft] = useState("");
  const [tab, setTab] = useState<"mainland" | "overseas">("mainland");

  if (!open) return null;

  const add = () => {
    const v = draft.trim();
    if (!v) { toast("请输入节点地址", "warn"); return; }
    if (!/^https?:\/\//.test(v)) { toast("地址需以 http(s):// 开头", "warn"); return; }
    setItems([...items, v]); setDraft("");
  };
  const remove = (i: number) => setItems(items.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items]; [next[i], next[j]] = [next[j]!, next[i]!]; setItems(next);
  };
  const save = () => onChange(items);
  const reset = () => setItems([...DEFAULT_CDN_HOSTS]);

  return (
    <div className="overlay sheet-on-mobile center-mobile" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal md cdn-editor">
        <div className="modal-head">
          <div className="modal-title">CDN 节点</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            <svg className="ico" viewBox="0 0 24 24" width={18} height={18}><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="login-tabs">
          <button className={`login-tab${tab === "mainland" ? " active" : ""}`} onClick={() => setTab("mainland")}>大陆</button>
          <button className={`login-tab${tab === "overseas" ? " active" : ""}`} onClick={() => setTab("overseas")}>海外</button>
        </div>
        <div className="modal-body cdn-body">
          <div className="cdn-add-row">
            <input className="text-input" style={{ flex: 1 }} value={draft} placeholder="https://upos-sz-mirrorali.bilivideo.com" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
            <button type="button" className="btn sm primary" onClick={add}>添加</button>
          </div>
          <div className="cdn-list">
            {items.map((h, i) => (
              <div key={h + i} className="cdn-row">
                <code className="cdn-host">{h}</code>
                <span className="cdn-ops">
                  <button type="button" className="btn sm ghost" onClick={() => move(i, -1)}>↑</button>
                  <button type="button" className="btn sm ghost" onClick={() => move(i, 1)}>↓</button>
                  <button type="button" className="btn sm ghost dangerous" onClick={() => remove(i)}>删除</button>
                </span>
              </div>
            ))}
            {items.length === 0 && <p className="muted small center">暂无节点</p>}
          </div>
          <div className="modal-foot">
            <button type="button" className="btn ghost" onClick={reset}>恢复默认</button>
            <div className="right">
              <button type="button" className="btn" onClick={onClose}>取消</button>
              <button type="button" className="btn primary" onClick={save}>保存</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}