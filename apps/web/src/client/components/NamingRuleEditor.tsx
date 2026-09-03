import { useState } from "react";
import { useToast } from "../lib/toast";

/** 命名分类（对齐引擎 ConventionType） */
export const CONVENTION_TYPES: Array<{ id: number; label: string }> = [
  { id: 11, label: "普通视频" }, { id: 12, label: "分P" }, { id: 13, label: "合集/系列" },
  { id: 14, label: "互动视频" }, { id: 20, label: "番剧/电影" }, { id: 30, label: "课程" },
  { id: 31, label: "商城课" }, { id: 40, label: "收藏夹" }, { id: 50, label: "UP 空间" },
  { id: 60, label: "历史记录" }, { id: 70, label: "稍后再看" }, { id: 80, label: "每周必看" },
  { id: 90, label: "音频" },
];

/** 可插入变量目录（对齐引擎 BASE_VARIABLES + ID_VARIABLES + 各类型变量，稳定标识） */
export const VARIABLES: Array<{ name: string; tpl: string; desc: string }> = [
  { name: "leaf_title", tpl: "{leaf_title}", desc: "视频/分P/剧集标题" },
  { name: "parent_title", tpl: "{parent_title}", desc: "主视频/父级标题" },
  { name: "group_title", tpl: "{group_title}", desc: "分组标题" },
  { name: "collection_title", tpl: "{collection_title}", desc: "合集标题" },
  { name: "section_title", tpl: "{section_title}", desc: "分节标题" },
  { name: "series_title", tpl: "{series_title}", desc: "系列/课程标题" },
  { name: "season_title", tpl: "{season_title}", desc: "番剧季标题" },
  { name: "episode_title", tpl: "{episode_title}", desc: "剧集标题" },
  { name: "p", tpl: "{p}", desc: "分P 序号" },
  { name: "number", tpl: "{number}", desc: "下载编号" },
  { name: "uploader", tpl: "{uploader}", desc: "UP 主昵称" },
  { name: "uploader_uid", tpl: "{uploader_uid}", desc: "UP 主 UID" },
  { name: "aid", tpl: "{aid}", desc: "稿件 aid" },
  { name: "bvid", tpl: "{bvid}", desc: "稿件 bvid" },
  { name: "cid", tpl: "{cid}", desc: "分P cid" },
  { name: "ep_id", tpl: "{ep_id}", desc: "剧集 ep_id" },
  { name: "season_id", tpl: "{season_id}", desc: "番剧 season_id" },
  { name: "pub_time", tpl: "{pub_time:%Y-%m-%d}", desc: "发布时间" },
  { name: "create_time", tpl: "{create_time:%Y-%m-%d}", desc: "创建时间" },
  { name: "video_quality", tpl: "{video_quality}", desc: "画质" },
  { name: "audio_quality", tpl: "{audio_quality}", desc: "音质" },
  { name: "video_codec", tpl: "{video_codec}", desc: "编码" },
];

export interface NamingRule {
  id: string; name: string; type: number; rule: string; default: boolean;
}

export function NamingRuleEditor({
  open, onClose, rules, onChange,
}: {
  open: boolean; onClose: () => void; rules: NamingRule[]; onChange: (rules: NamingRule[]) => void;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState<NamingRule | null>(null);
  const [draft, setDraft] = useState<NamingRule | null>(null);

  if (!open) return null;

  const startEdit = (r: NamingRule) => { setEditing(r); setDraft({ ...r }); };
  const addRule = () => {
    const nr: NamingRule = { id: crypto.randomUUID(), name: "新规则", type: 11, rule: "{leaf_title}", default: false };
    const next = [...rules, nr];
    onChange(next);
    startEdit(nr);
  };
  const removeRule = (id: string) => {
    const target = rules.find((r) => r.id === id);
    if (target?.default) { toast("默认规则不可删除", "warn"); return; }
    onChange(rules.filter((r) => r.id !== id));
  };
  const setDefault = (id: string) => {
    onChange(rules.map((r) => ({ ...r, default: r.id === id })));
  };
  const saveDraft = () => {
    if (!draft) return;
    if (!draft.rule.trim()) { toast("规则模板不能为空", "warn"); return; }
    if (draft.default === undefined) draft.default = false;
    onChange(rules.map((r) => (r.id === draft.id ? { ...draft } : r)));
    setEditing(null); setDraft(null);
    toast("规则已保存", "ok");
  };

  return (
    <div className="overlay sheet-on-mobile center-mobile" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal lg naming-editor">
        <div className="modal-head">
          <div className="modal-title">命名规则编辑器</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            <svg className="ico" viewBox="0 0 24 24" width={18} height={18}><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="modal-body naming-body">
          {!editing ? (
            <div className="naming-rules-list">
              <div className="naming-list-head">
                <span>规则名</span><span>分类</span><span>模板</span><span>操作</span>
              </div>
              {rules.map((r) => (
                <div key={r.id} className="naming-rule-row">
                  <span className="naming-name">{r.name}{r.default ? <em className="naming-default">默认</em> : null}</span>
                  <span className="naming-type">{CONVENTION_TYPES.find((t) => t.id === r.type)?.label ?? r.type}</span>
                  <code className="naming-rule">{r.rule}</code>
                  <span className="naming-ops">
                    <button type="button" className="btn sm ghost" onClick={() => startEdit(r)}>编辑</button>
                    {!r.default && <button type="button" className="btn sm ghost" onClick={() => setDefault(r.id)}>设默认</button>}
                    {!r.default && <button type="button" className="btn sm ghost dangerous" onClick={() => removeRule(r.id)}>删除</button>}
                  </span>
                </div>
              ))}
              <button type="button" className="btn sm" onClick={addRule}>+ 新增规则</button>
            </div>
          ) : (
            <div className="naming-edit-form">
              <div className="dl-field">
                <span>规则名</span>
                <input className="text-input" value={draft!.name} onChange={(e) => setDraft({ ...draft!, name: e.target.value })} />
              </div>
              <div className="dl-field">
                <span>分类</span>
                <select value={draft!.type} onChange={(e) => setDraft({ ...draft!, type: Number(e.target.value) })}>
                  {CONVENTION_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </div>
              <div className="dl-field">
                <span>模板</span>
                <textarea className="text-input naming-template" rows={3} value={draft!.rule} onChange={(e) => setDraft({ ...draft!, rule: e.target.value })} />
              </div>
              <div className="naming-palette">
                <div className="dl-card-title">插入变量</div>
                <div className="naming-var-grid">
                  {VARIABLES.map((v) => (
                    <button key={v.name} type="button" className="btn sm ghost" title={v.desc} onClick={() => setDraft({ ...draft!, rule: draft!.rule + v.tpl })}>
                      {v.tpl}
                    </button>
                  ))}
                </div>
              </div>
              <div className="modal-foot">
                <button type="button" className="btn" onClick={() => { setEditing(null); setDraft(null); }}>取消</button>
                <div className="right">
                  <button type="button" className="btn primary" onClick={saveDraft}>保存</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}