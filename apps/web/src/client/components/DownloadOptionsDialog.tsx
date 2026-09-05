import { useEffect, useState } from "react";
import { mediaOptions, createTasks } from "../services/client";
import { DuplicateDialog } from "./DuplicateDialog";
import { StyleEditor, type StyleValues } from "./StyleEditor";
import { useDownloadOptions, formToExtras, type ExtraOptionState, type DanmakuFormat, type SubtitleFormat, type CoverFormat, type MetadataFormat } from "../store/useDownloadOptions";
import { useSettingsStore } from "../store/useSettingsStore";
import { useTasksStore } from "../store/useTasksStore";
import { useToast } from "../lib/toast";
import { Icon } from "../lib/icons";
import type { MediaOptionSummary } from "../services/types";

export function DownloadOptionsDialog() {
  const {
    open, items, media, mediaLoading, mediaError, form,
    videoQualityId, audioQualityId, codecId, container,
    close, setMedia, setMediaLoading, setMediaError, patchForm, setQuality, setAudio, setCodec, setContainer,
  } = useDownloadOptions();
  const { toast } = useToast();
  const setTasks = useTasksStore((s) => s.setTasks);
  const settingsCfg = useSettingsStore((st) => st.config);
  const settingsLoad = useSettingsStore((st) => st.load);
  const [dupList, setDupList] = useState<Array<{ itemId: string; title: string }>>([]);
  const [activeTab, setActiveTab] = useState("media");
  // 样式编辑弹窗（kind + 当前值）
  const [styleKind, setStyleKind] = useState<"" | "danmaku" | "subtitle">("");
  // 字幕语言选择弹窗
  const [langOpen, setLangOpen] = useState(false);
  // 本次任务命名规则（undefined = 沿用全局设置默认）
  const [namingRuleId, setNamingRuleId] = useState<string | undefined>(undefined);
  const allRules = (settingsCfg?.fileNaming?.rules as Array<{ id: string; name: string; type: number; rule: string; default?: boolean }> | undefined) ?? [];
  const namingChoices = allRules.length > 0
    ? [{ id: "", name: "沿用全局设置", type: 0 as number, rule: "" }, ...allRules]
    : [{ id: "", name: "沿用全局设置", type: 0 as number, rule: "" }];

  // 打开时确保全局配置已加载（用于初始化附加默认与命名规则列表）
  useEffect(() => {
    if (!open) return;
    if (!useSettingsStore.getState().config && !useSettingsStore.getState().loading) {
      void settingsLoad();
    }
  }, [open, settingsLoad]);

  // 打开时拉取首个条目的媒体候选
  useEffect(() => {
    if (!open || !items.length) return;
    setMediaLoading(true);
    mediaOptions(items[0]!.id)
      .then((m) => setMedia(m))
      .catch((e) => setMediaError(e instanceof Error ? e.message : String(e)));
  }, [open, items, setMedia, setMediaLoading, setMediaError]);

  if (!open) return null;

  // 组装 DownloadOptions（点确认时）
  const buildOptions = (): void => {
    const extras = formToExtras(form);
    const selectedRule = namingRuleId ? allRules.find((r) => r.id === namingRuleId) : undefined;
    const options: import("../services/types").DownloadOptions = {
      downloadVideo: form.video,
      downloadAudio: form.audio,
      mergeVideoAudio: form.merge,
      keepOriginalFiles: form.keep,
      ...(form.keep ? { keepOriginalFilesType: form.keepType === "both" ? 2 : form.keepType === "video" ? 0 : 1 } : {}),
      ...(videoQualityId > 0 ? { videoQualityId } : {}),
      ...(audioQualityId > 0 ? { audioQualityId } : {}),
      ...(codecId > 0 ? { videoCodecId: codecId } : {}),
      ...(selectedRule ? { naming: { conventionType: selectedRule.type, rule: selectedRule.rule, number: "" } } : {}),
      extras,
      container,
    };
    useDownloadOptions.getState().setResolved(options);
  };

  const confirm = async () => {
    if (!form.video && !form.audio && !anyExtra(form)) {
      toast("未选择任何下载内容", "warn");
      return;
    }
    // 强提示：不合并 → 两个独立文件
    if (form.video && form.audio && !form.merge) {
      toast("将得到视频、音频两个独立文件", "warn");
    }
    // 只下视频不下音频 → 无声视频
    if (form.video && !form.audio) {
      toast("将得到无声视频", "warn");
    }
    buildOptions();
    const resolved = useDownloadOptions.getState().resolved;
    const ids = items.map((i) => i.id);
    try {
      const { tasks, duplicates } = await createTasks(ids, resolved);
      if (tasks.length) setTasks(tasks);
      if (duplicates.length) toast(`已跳过 ${duplicates.length} 个重复项`, "warn");
      toast(`已创建 ${tasks.length} 个下载任务`, "ok");
      close();
    } catch (e) {
      const err = e as Error & { code?: string; duplicates?: Array<{ itemId: string; title: string }> };
      if (err.code === "DUPLICATE" || (err.duplicates && err.duplicates.length)) {
        // 全部/部分重复：用本次尝试的条目展示重复列表，提供强制下载
        setDupList(err.duplicates?.length ? err.duplicates : items.map((i) => ({ itemId: i.id, title: i.title })));
      } else {
        toast("创建任务失败：" + (e instanceof Error ? e.message : String(e)), "err");
      }
    }
  };

  const forceDownload = async (dupIds: string[]) => {
    const resolved = useDownloadOptions.getState().resolved;
    try {
      const { tasks } = await createTasks(dupIds, resolved, true);
      if (tasks.length) setTasks([...useTasksStore.getState().tasks, ...tasks]);
      toast("已强制下载 " + tasks.length + " 个", "ok");
      setDupList([]);
      close();
    } catch (e) {
      toast("强制下载失败：" + (e instanceof Error ? e.message : String(e)), "err");
    }
  };

  const chips = buildChips(form);

  return (
    <div className="overlay sheet-on-mobile" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal lg dl-options">
        <div className="modal-head">
          <div className="modal-title">下载选项</div>
          <button type="button" className="icon-btn" onClick={close} aria-label="关闭">
            <svg className="ico" viewBox="0 0 24 24" width={18} height={18}><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="tabs-nav">
          <button type="button" className={`tab${activeTab === "media" ? " active" : ""}`} onClick={() => setActiveTab("media")}>媒体设置</button>
          <button type="button" className={`tab${activeTab === "additional" ? " active" : ""}`} onClick={() => setActiveTab("additional")}>附加文件</button>
          <button type="button" className={`tab${activeTab === "download" ? " active" : ""}`} onClick={() => setActiveTab("download")}>下载设置</button>
        </div>
        <div className="modal-body dl-body">
          {activeTab === "media" && (
            <MediaPane
              media={media} loading={mediaLoading} error={mediaError}
              form={form} patchForm={patchForm}
              videoQualityId={videoQualityId} audioQualityId={audioQualityId} codecId={codecId}
              setQuality={setQuality} setAudio={setAudio} setCodec={setCodec}
            />
          )}
          {activeTab === "additional" && (
            <AdditionalPane
              form={form} patchForm={patchForm}
              container={container}
              styleKind={styleKind} setStyleKind={setStyleKind}
              langOpen={langOpen} setLangOpen={setLangOpen}
            />
          )}
          {activeTab === "download" && (
            <DownloadPane container={container} setContainer={setContainer}
              namingRuleId={namingRuleId} setNamingRuleId={setNamingRuleId}
              namingChoices={namingChoices} />
          )}
        </div>
        <div className="dl-footer">
          <div className="dl-preview">
            {chips.length ? chips.map((c) => <span key={c} className={`tag ${c}`}>{c}</span>) : <span className="tag none">未选择内容</span>}
          </div>
          <div className="dl-footer-actions">
            <button type="button" className="btn" onClick={close}>取消</button>
            <button type="button" className="btn primary" onClick={confirm}>确定</button>
          </div>
        </div>
      </div>
      <DuplicateDialog open={dupList.length > 0} onClose={() => setDupList([])} duplicates={dupList} onForce={forceDownload} />
    </div>
  );
}

function fmtBytes(b?: number): string {
  if (!b) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, n = b;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i > 1 ? 1 : 0)} ${u[i]}`;
}

function fmtBps(bps?: number): string {
  if (!bps || bps <= 0) return "";
  return (bps / 1_000_000).toFixed(bps >= 10_000_000 ? 0 : 1) + " Mbps";
}

function MediaPane({ media, loading, error, form, patchForm, videoQualityId, audioQualityId, codecId, setQuality, setAudio, setCodec }: {
  media?: MediaOptionSummary; loading: boolean; error?: string;
  form: ExtraOptionState;
  patchForm: (p: Partial<ExtraOptionState>) => void;
  videoQualityId: number; audioQualityId: number; codecId: number;
  setQuality: (v: number) => void; setAudio: (v: number) => void; setCodec: (v: number) => void;
}) {
  const qualities = media?.qualities ?? [];
  const audioQ = media?.audioQualities ?? [];
  const selQ = qualities.find((q) => q.id === videoQualityId);
  const codecs = selQ?.codecs ?? [];
  // 总大小估算：选中画质视频带宽 + 选中音频带宽，乘时长/数据率转字节。
  // Auto(0) 时回落到列表第一项（B 站接口按质量从高到低，即“最高可用”），
  // 以便默认就能看到估算大小；未知带宽时返回 null（不硬编数字）。
  // 估算只算用户实际勾选的内容：勾了视频才算视频带宽，勾了音频才算音频带宽。
  const effQ = selQ ?? qualities[0];
  const effA = audioQ.find((a) => a.id === audioQualityId) ?? audioQ[0];
  const sizeBytes = (() => {
    if (!media || media.timelength <= 0) return null;
    const vbw = form.video ? (effQ?.videoBandwidth ?? 0) : 0;
    const abw = form.audio ? (effA?.audioBandwidth ?? 0) : 0;
    const total = (vbw + abw) * (media.timelength / 1000) / 8;
    return total > 0 ? Math.round(total) : null;
  })();
  const sizeBasis = selQ ? "" : (effQ ? `（按 ${effQ.label} 估算）` : "");
  return (
    <div className="dl-pane" data-tab="media">
      <div className="dl-card">
        <div className="dl-card-title">媒体信息</div>
        {media && <span className={`badge dl-type${media.mediaType === "dash" ? "" : " mp4"}`}>{media.mediaType === "dash" ? "DASH 流" : "单文件/MP4"}</span>}
        {loading ? <div className="muted small">加载媒体候选…</div>
          : error ? <div className="muted small">加载失败：{error}</div>
          : <div className="muted small">已获取可选的画质/音质/编码（来自真实媒体探测）</div>}
        <div className="dl-selects">
          <label className="dl-field">
            <span>画质</span>
            <select value={videoQualityId} onChange={(e) => setQuality(Number(e.target.value))}>
              <option value={0}>Auto（按优先级）</option>
              {qualities.map((q) => <option key={q.id} value={q.id}>{q.label}{fmtBps(q.videoBandwidth) ? " · " + fmtBps(q.videoBandwidth) : ""}</option>)}
            </select>
          </label>
          <label className="dl-field">
            <span>音质</span>
            <select value={audioQualityId} onChange={(e) => setAudio(Number(e.target.value))}>
              <option value={0}>Auto（按优先级）</option>
              {audioQ.map((q) => <option key={q.id} value={q.id}>{q.label}{fmtBps(q.audioBandwidth) ? " · " + fmtBps(q.audioBandwidth) : ""}</option>)}
            </select>
          </label>
          <label className="dl-field">
            <span>编码</span>
            <select value={codecId} onChange={(e) => setCodec(Number(e.target.value))}>
              <option value={0}>Auto（按优先级）</option>
              {codecs.map((cc) => <option key={cc.id} value={cc.id}>{cc.label}</option>)}
            </select>
          </label>
          {media?.timelength ? <div className="muted small">时长 {fmtDuration(media.timelength)}{sizeBytes ? ` · 约合 ${fmtBytes(sizeBytes)}${sizeBasis}` : ""}</div> : null}
        </div>
      </div>
      <div className="dl-card">
        <div className="dl-card-title">媒体选项</div>
        <ToggleRow label="下载独立视频流" checked={form.video} onChange={(v) => patchForm({ video: v })} />
        <ToggleRow label="下载独立音频流" checked={form.audio} onChange={(v) => patchForm({ audio: v })} />
        <ToggleRow label="合并视频与音频" checked={form.merge} disabled={!form.video || !form.audio} onChange={(v) => patchForm({ merge: v })} />
        <ToggleRow label="保留原始文件" checked={form.keep} disabled={!form.merge} onChange={(v) => patchForm({ keep: v })} />
        {form.keep && (
          <div className="dl-inline">
            <span>保留类型</span>
            <select value={form.keepType} onChange={(e) => patchForm({ keepType: e.target.value as "both" | "video" | "audio" })}>
              <option value="both">视频 + 音频</option>
              <option value="video">仅视频</option>
              <option value="audio">仅音频</option>
            </select>
          </div>
        )}
      </div>
    </div>
  );
}


const DANMAKU_FORMATS: Array<{ v: DanmakuFormat; label: string }> = [
  { v: "xml", label: "XML" }, { v: "ass", label: "ASS" }, { v: "json", label: "JSON" },
];
const SUBTITLE_FORMATS: Array<{ v: SubtitleFormat; label: string }> = [
  { v: "srt", label: "SRT" }, { v: "lrc", label: "LRC" }, { v: "txt", label: "TXT" },
  { v: "ass", label: "ASS" }, { v: "json", label: "JSON" },
];
const COVER_FORMATS: Array<{ v: CoverFormat; label: string }> = [
  { v: "jpg", label: "JPG" }, { v: "png", label: "PNG" }, { v: "avif", label: "AVIF" }, { v: "webp", label: "WEBP" },
];
const METADATA_FORMATS: Array<{ v: MetadataFormat; label: string }> = [
  { v: "nfo", label: "NFO" }, { v: "json", label: "JSON" },
];

function AdditionalPane({
  form, patchForm, container, styleKind, setStyleKind, langOpen, setLangOpen,
}: {
  form: ExtraOptionState;
  patchForm: (p: Partial<ExtraOptionState>) => void;
  container: "mp4" | "mkv";
  styleKind: "" | "danmaku" | "subtitle";
  setStyleKind: (v: "" | "danmaku" | "subtitle") => void;
  langOpen: boolean;
  setLangOpen: (v: boolean) => void;
}) {
  const canAssEmbed = container === "mkv";
  const patch = (p: Partial<ExtraOptionState>) => patchForm(p);
  return (
    <div className="dl-pane" data-tab="additional">
      <div className="dl-card">
        <div className="dl-card-title">弹幕</div>
        <ToggleRow label="下载弹幕" checked={form.danmaku.enabled} onChange={(v) => patch({ danmaku: { ...form.danmaku, enabled: v } })} />
        {form.danmaku.enabled && (
          <div className="dl-extra-rows">
            <InlineSelect label="格式" value={form.danmaku.format} options={DANMAKU_FORMATS}
              onChange={(format) => patch({ danmaku: { ...form.danmaku, format } })} />
            <div className="dl-inline"><span>样式（仅 ASS 生效）</span>
              <button type="button" className="btn sm ghost" onClick={() => setStyleKind("danmaku")}>自定义…</button>
            </div>
            <ToggleRow label={`嵌入视频（作为字幕轨，需 ASS + ${canAssEmbed ? "MKV" : "容器切到 MKV"}）`}
              checked={form.danmaku.embed}
              disabled={!canAssEmbed || form.danmaku.format !== "ass"}
              onChange={(v) => patch({ danmaku: { ...form.danmaku, embed: v } })} />
            {form.danmaku.embed && canAssEmbed && form.danmaku.format === "ass" && (
              <ToggleRow label="嵌入后删除源文件" checked={form.danmaku.deleteAfterEmbed}
                onChange={(v) => patch({ danmaku: { ...form.danmaku, deleteAfterEmbed: v } })} />
            )}
          </div>
        )}
      </div>
      <div className="dl-card">
        <div className="dl-card-title">字幕</div>
        <ToggleRow label="下载字幕" checked={form.subtitle.enabled} onChange={(v) => patch({ subtitle: { ...form.subtitle, enabled: v } })} />
        {form.subtitle.enabled && (
          <div className="dl-extra-rows">
            <InlineSelect label="格式" value={form.subtitle.format} options={SUBTITLE_FORMATS}
              onChange={(format) => patch({ subtitle: { ...form.subtitle, format } })} />
            <div className="dl-inline"><span>语言</span>
              <button type="button" className="btn sm ghost" onClick={() => setLangOpen(true)}>
                {form.subtitle.language.downloadSpecified && form.subtitle.language.specifiedLanguages.length > 0
                  ? `指定 ${form.subtitle.language.specifiedLanguages.length} 种`
                  : "全部语言"}
              </button>
            </div>
            <div className="dl-inline"><span>样式（仅 ASS 生效）</span>
              <button type="button" className="btn sm ghost" onClick={() => setStyleKind("subtitle")}>自定义…</button>
            </div>
            <ToggleRow label={`嵌入视频（作为字幕轨，需 ASS + ${canAssEmbed ? "MKV" : "容器切到 MKV"}）`}
              checked={form.subtitle.embed}
              disabled={!canAssEmbed || form.subtitle.format !== "ass"}
              onChange={(v) => patch({ subtitle: { ...form.subtitle, embed: v } })} />
            {form.subtitle.embed && canAssEmbed && form.subtitle.format === "ass" && (
              <ToggleRow label="嵌入后删除源文件" checked={form.subtitle.deleteAfterEmbed}
                onChange={(v) => patch({ subtitle: { ...form.subtitle, deleteAfterEmbed: v } })} />
            )}
          </div>
        )}
      </div>
      <div className="dl-card">
        <div className="dl-card-title">封面</div>
        <ToggleRow label="下载封面" checked={form.cover.enabled} onChange={(v) => patch({ cover: { ...form.cover, enabled: v } })} />
        {form.cover.enabled && (
          <div className="dl-extra-rows">
            <InlineSelect label="格式" value={form.cover.format} options={COVER_FORMATS}
              onChange={(format) => {
                const next = { ...form.cover, format };
                if (format === "avif") next.attach = false;
                patch({ cover: next });
              }} />
            <ToggleRow label="嵌入封面到视频文件" checked={form.cover.attach} disabled={form.cover.format === "avif"}
              onChange={(v) => patch({ cover: { ...form.cover, attach: v } })} />
            {form.cover.attach && form.cover.format !== "avif" && (
              <ToggleRow label="嵌入后删除源图片" checked={form.cover.deleteAfterAttach}
                onChange={(v) => patch({ cover: { ...form.cover, deleteAfterAttach: v } })} />
            )}
          </div>
        )}
      </div>
      <div className="dl-card">
        <div className="dl-card-title">章节</div>
        <ToggleRow label="嵌入章节信息（合并时生效）" checked={form.chapter.embed}
          onChange={(v) => patch({ chapter: { embed: v } })} />
      </div>
      <div className="dl-card">
        <div className="dl-card-title">元数据</div>
        <ToggleRow label="下载元数据（NFO 刮削）" checked={form.metadata.enabled}
          onChange={(v) => patch({ metadata: { ...form.metadata, enabled: v } })} />
        {form.metadata.enabled && (
          <div className="dl-extra-rows">
            <InlineSelect label="格式" value={form.metadata.format} options={METADATA_FORMATS}
              onChange={(format) => patch({ metadata: { ...form.metadata, format } })} />
          </div>
        )}
      </div>
      {/* 字幕语言选择 */}
      <SubtitleLanguageDialog open={langOpen} onClose={() => setLangOpen(false)}
        selection={form.subtitle.language}
        onChange={(language) => patch({ subtitle: { ...form.subtitle, language } })} />
      <StyleEditor
        open={styleKind === "danmaku" || styleKind === "subtitle"}
        onClose={() => setStyleKind("")}
        kind={styleKind === "subtitle" ? "subtitle" : "danmaku"}
        value={(styleKind === "subtitle" ? form.subtitle.style : form.danmaku.style) as StyleValues | undefined}
        onChange={(sv) => {
          if (styleKind === "subtitle") patch({ subtitle: { ...form.subtitle, style: sv as ExtraOptionState["subtitle"]["style"] } });
          else patch({ danmaku: { ...form.danmaku, style: sv as ExtraOptionState["danmaku"]["style"] } });
        }}
      />
    </div>
  );
}


function DownloadPane({ container, setContainer, namingRuleId, setNamingRuleId, namingChoices }: {
  container: "mp4" | "mkv";
  setContainer: (v: "mp4" | "mkv") => void;
  namingRuleId: string | undefined;
  setNamingRuleId: (v: string | undefined) => void;
  namingChoices: Array<{ id: string; name: string; type: number; rule: string }>;
}) {
  return (
    <div className="dl-pane" data-tab="download">
      <div className="dl-card">
        <div className="dl-card-title">输出</div>
        <div className="dl-field">
          <span>输出容器</span>
          <div className="seg">
            <button type="button" className={`seg-btn${container === "mp4" ? " active" : ""}`} onClick={() => setContainer("mp4")}>MP4</button>
            <button type="button" className={`seg-btn${container === "mkv" ? " active" : ""}`} onClick={() => setContainer("mkv")}>MKV</button>
          </div>
        </div>
        <label className="dl-field">
          <span>命名规则</span>
          <select className="text-input" value={namingRuleId ?? ""} onChange={(e) => setNamingRuleId(e.target.value || undefined)}>
            {namingChoices.map((r) => <option key={r.id || "global"} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        <div className="muted small" style={{ marginTop: 6 }}>编号与起始号沿用全局设置（设置页 &gt; 命名规则）。</div>
      </div>
    </div>
  );
}

function InlineSelect<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: Array<{ v: T; label: string }>; onChange: (v: T) => void;
}) {
  return (
    <label className="dl-inline">
      <span>{label}</span>
      <select className="text-input" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
      </select>
    </label>
  );
}

/** 字幕语言选择：可选语言与 B 站字幕接口一致 */
const SUBTITLE_LANGS = [
  { v: "zh-CN", label: "简体中文" }, { v: "zh-TW", label: "繁体中文" },
  { v: "en", label: "英语" }, { v: "ja", label: "日语" },
  { v: "ko", label: "韩语" }, { v: "ai-zh", label: "AI 中文" },
  { v: "ai-en", label: "AI 英文" },
];
function SubtitleLanguageDialog({ open, onClose, selection, onChange }: {
  open: boolean; onClose: () => void;
  selection: { downloadSpecified: boolean; specifiedLanguages: string[] };
  onChange: (v: { downloadSpecified: boolean; specifiedLanguages: string[] }) => void;
}) {
  const [specified, setSpecified] = useState<boolean>(selection.downloadSpecified);
  const [langs, setLangs] = useState<string[]>(selection.specifiedLanguages);
  if (!open) return null;
  const toggleLang = (v: string) => {
    setLangs((cur) => cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]);
  };
  return (
    <div className="overlay sheet-on-mobile center-mobile" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal sm">
        <div className="modal-head"><div className="modal-title">字幕语言</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭"><Icon name="x" size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="dl-toggle"><span>只下载指定语言</span>
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
          {specified && langs.length === 0 && <div className="muted small">请至少选择一种语言</div>}
        </div>
        <div className="modal-foot">
          <div className="right">
            <button type="button" className="btn" onClick={onClose}>取消</button>
            <button type="button" className="btn primary" onClick={() => { onChange({ downloadSpecified: specified, specifiedLanguages: specified ? langs : [] }); onClose(); }}>确定</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ToggleRow({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="dl-toggle">
      <span className={disabled ? "muted" : ""}>{label}</span>
      <input type="checkbox" className="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </div>
  );
}

function anyExtra(form: ExtraOptionState): boolean {
  return form.video || form.audio || form.danmaku.enabled || form.subtitle.enabled || form.cover.enabled || form.chapter.embed || form.metadata.enabled;
}

function buildChips(form: ExtraOptionState): string[] {
  const chips: string[] = [];
  if (form.video) chips.push("video");
  if (form.audio) chips.push("audio");
  if (form.danmaku.enabled) chips.push("danmaku");
  if (form.subtitle.enabled) chips.push("subtitle");
  if (form.cover.enabled) chips.push("cover");
  if (form.chapter.embed) chips.push("chapter");
  if (form.metadata.enabled) chips.push("metadata");
  return chips;
}

/** 将毫秒转为时分秒文本（B 站 playurl timelength 单位为毫秒） */
function fmtDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
