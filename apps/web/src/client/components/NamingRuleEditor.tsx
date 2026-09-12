import { useState } from "react";
import { useToast } from "../lib/toast";
import { GuideDialog } from "./GuideDialog";
import { NAMING_RULE_GUIDE } from "../lib/guides";
import { previewNamingRule } from "../services/client";
import { Icon } from "../lib/icons";
import { t as tr } from "../lib/i18n";

/**
 * 命名分类（对齐引擎 ConventionType）。
 *
 * ⚠️ 文案逐字取原版 `CONVENTION_TYPE` 的简中译文（`zh_CN.ts`）：
 * Single Video / Multi-part Series / Collection / Interactive Video / Film & TV / Courses /
 * Mall Courses / Favorites / Profile / History / Watch Later / Weekly Picks / Music。
 * 我们原来自己写的「普通视频 / 分P / 合集·系列 / 番剧·电影 / 商城课 / UP 空间 / 音频」
 * 与原版不一致（展示方式要求逐字对齐），而且这些自造词在 i18n 字典里查不到。
 */
export const CONVENTION_TYPES: Array<{ id: number; label: string }> = [
  { id: 11, label: "单个视频" }, { id: 12, label: "分P视频" }, { id: 13, label: "视频合集" },
  { id: 14, label: "互动视频" }, { id: 20, label: "影视" }, { id: 30, label: "课程" },
  { id: 31, label: "会员购课程" }, { id: 40, label: "收藏夹" }, { id: 50, label: "个人空间" },
  { id: 60, label: "历史记录" }, { id: 70, label: "稍后再看" }, { id: 80, label: "每周必看" },
  { id: 90, label: "音乐" },
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
  /** 「说明」弹窗（原版编辑命名规则里的 Instructions，正文 NAMING_RULE_GUIDE，`edit_rule.py:216`） */
  const [guideOpen, setGuideOpen] = useState(false);
  /** 「预览」结果（原版 `EditRuleDialog.on_preview`：标题「预览」+ 子目录 / 文件名） */
  const [preview, setPreview] = useState<{ folder: string; fileName: string } | null>(null);

  if (!open) return null;

  /** 试渲染当前草稿（dry-run 在后端做，用示例数据） */
  const doPreview = async () => {
    if (!draft) return;
    try {
      const r = await previewNamingRule(draft.rule, draft.type);
      if (!r.ok) { toast(r.message ?? "命名规则无效", "warn"); return; }
      setPreview({ folder: r.folder ?? "", fileName: r.fileName ?? "" });
    } catch (e) {
      toast("预览失败：" + (e instanceof Error ? e.message : String(e)), "err");
    }
  };

  const startEdit = (r: NamingRule) => { setEditing(r); setDraft({ ...r }); };
  const addRule = () => {
    const nr: NamingRule = { id: crypto.randomUUID(), name: "新规则", type: 11, rule: "{leaf_title}", default: false };
    const next = [...rules, nr];
    onChange(next);
    startEdit(nr);
  };
  const removeRule = (id: string) => {
    const target = rules.find((r) => r.id === id);
    if (target?.default) { toast(tr("无法删除默认规则"), "warn"); return; }
    onChange(rules.filter((r) => r.id !== id));
  };
  const setDefault = (id: string) => {
    onChange(rules.map((r) => ({ ...r, default: r.id === id })));
  };
  const saveDraft = () => {
    if (!draft) return;
    if (!draft.rule.trim()) { toast(tr("规则模板不能为空"), "warn"); return; }
    if (draft.default === undefined) draft.default = false;
    onChange(rules.map((r) => (r.id === draft.id ? { ...draft } : r)));
    setEditing(null); setDraft(null);
    toast(tr("规则已保存"), "ok");
  };

  return (
    <div className="overlay sheet-on-mobile center-mobile" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal lg naming-editor">
        <div className="modal-head">
          <div className="modal-title">{tr("命名规则编辑器")}</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={tr("关闭")}>
            <svg className="ico" viewBox="0 0 24 24" width={18} height={18}><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="modal-body naming-body">
          {!editing ? (
            <div className="naming-rules-list">
              <div className="naming-list-head">
                <span>{tr("规则名")}</span><span>{tr("分类")}</span><span>{tr("模板")}</span><span>{tr("操作")}</span>
              </div>
              {rules.map((r) => (
                <div key={r.id} className="naming-rule-row">
                  <span className="naming-name">{r.name}{r.default ? <em className="naming-default">{tr("默认")}</em> : null}</span>
                  <span className="naming-type">{tr(CONVENTION_TYPES.find((x) => x.id === r.type)?.label ?? String(r.type))}</span>
                  <code className="naming-rule">{r.rule}</code>
                  <span className="naming-ops">
                    <button type="button" className="btn sm ghost" onClick={() => startEdit(r)}>{tr("编辑")}</button>
                    {!r.default && <button type="button" className="btn sm ghost" onClick={() => setDefault(r.id)}>{tr("设默认")}</button>}
                    {!r.default && <button type="button" className="btn sm ghost dangerous" onClick={() => removeRule(r.id)}>{tr("删除")}</button>}
                  </span>
                </div>
              ))}
              <button type="button" className="btn sm" onClick={addRule}>+ 新增规则</button>
            </div>
          ) : (
            <div className="naming-edit-form">
              <div className="dl-field">
                <span>{tr("规则名")}</span>
                <input className="text-input" value={draft!.name} onChange={(e) => setDraft({ ...draft!, name: e.target.value })} />
              </div>
              <div className="dl-field">
                <span>{tr("分类")}</span>
                <select value={draft!.type} onChange={(e) => setDraft({ ...draft!, type: Number(e.target.value) })}>
                  {CONVENTION_TYPES.map((x) => <option key={x.id} value={x.id}>{tr(x.label)}</option>)}
                </select>
              </div>
              <div className="dl-field">
                <span>{tr("模板")}</span>
                <textarea className="text-input naming-template" rows={3} value={draft!.rule} onChange={(e) => setDraft({ ...draft!, rule: e.target.value })} />
              </div>
              <div className="naming-palette">
                <div className="dl-card-title">{tr("插入变量")}</div>
                <div className="naming-var-grid">
                  {VARIABLES.map((v) => (
                    <button key={v.name} type="button" className="btn sm ghost" title={v.desc} onClick={() => setDraft({ ...draft!, rule: draft!.rule + v.tpl })}>
                      {v.tpl}
                    </button>
                  ))}
                </div>
              </div>
              <div className="modal-foot">
                <button type="button" className="btn ghost" onClick={() => void doPreview()}>{tr("预览")}</button>
                <button type="button" className="btn ghost" onClick={() => setGuideOpen(true)}>{tr("说明")}</button>
                <button type="button" className="btn" onClick={() => { setEditing(null); setDraft(null); }}>{tr("取消")}</button>
                <div className="right">
                  <button type="button" className="btn primary" onClick={saveDraft}>{tr("保存")}</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      <GuideDialog open={guideOpen} title={tr("命名规则说明")} text={NAMING_RULE_GUIDE} onClose={() => setGuideOpen(false)} />
      {/* 预览（原版标题「预览」，正文 `子目录：{folder}\n文件名：{filename}`）。
          原版用当前解析到的那个稿件渲染；设置页没有解析上下文，所以用示例数据并标注出来 */}
      {preview && (
        <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setPreview(null); }}>
          <div className="modal sm" role="dialog" aria-modal="true">
            <div className="modal-head">
              <div className="modal-title">{tr("预览")}</div>
              <button type="button" className="icon-btn" onClick={() => setPreview(null)} aria-label={tr("关闭")}><Icon name="x" size={18} /></button>
            </div>
            <div className="modal-body">
              <pre className="meta-pre">子目录：{preview.folder || "（根目录）"}
文件名：{preview.fileName}</pre>
              <p className="muted small" style={{ marginTop: 8 }}>以上为示例数据（示例UP主 / 示例视频标题），仅用于确认规则写法。</p>
            </div>
            <div className="modal-foot">
              <div className="right"><button type="button" className="btn" onClick={() => setPreview(null)}>{tr("关闭")}</button></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}