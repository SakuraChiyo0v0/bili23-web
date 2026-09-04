import { useEffect, useState } from "react";
import { mediaOptions, createTasks } from "../services/client";
import { DuplicateDialog } from "./DuplicateDialog";
import { useDownloadOptions } from "../store/useDownloadOptions";
import { useTasksStore } from "../store/useTasksStore";
import { useToast } from "../lib/toast";
import type { MediaOptionSummary } from "../services/types";

export function DownloadOptionsDialog() {
  const {
    open, items, media, mediaLoading, mediaError, form,
    videoQualityId, audioQualityId, codecId,
    close, setMedia, setMediaLoading, setMediaError, patchForm, setQuality, setAudio, setCodec,
  } = useDownloadOptions();
  const { toast } = useToast();
  const setTasks = useTasksStore((s) => s.setTasks);
  const [dupList, setDupList] = useState<Array<{ itemId: string; title: string }>>([]);
  const [activeTab, setActiveTab] = useState("media");

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
    const extras = {
      danmaku: { enabled: form.danmaku },
      subtitle: { enabled: form.subtitle },
      cover: { enabled: form.cover },
      chapter: { embed: form.chapter },
      metadata: { enabled: form.metadata },
    };
    const options = {
      downloadVideo: form.video,
      downloadAudio: form.audio,
      mergeVideoAudio: form.merge,
      keepOriginalFiles: form.keep,
      ...(form.keep ? { keepOriginalFilesType: form.keepType === "both" ? 2 : form.keepType === "video" ? 0 : 1 } : {}),
      ...(videoQualityId > 0 ? { videoQualityId } : {}),
      ...(audioQualityId > 0 ? { audioQualityId } : {}),
      ...(codecId > 0 ? { videoCodecId: codecId } : {}),
      extras,
      container: "mp4" as const,
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
          {activeTab === "additional" && <AdditionalPane form={form} patchForm={patchForm} />}
          {activeTab === "download" && <DownloadPane />}
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

function MediaPane({ media, loading, error, form, patchForm, videoQualityId, audioQualityId, codecId, setQuality, setAudio, setCodec }: {
  media?: MediaOptionSummary; loading: boolean; error?: string;
  form: { video: boolean; audio: boolean; merge: boolean; keep: boolean; keepType: string };
  patchForm: (p: Partial<{ video: boolean; audio: boolean; merge: boolean; keep: boolean; keepType: "both" | "video" | "audio" }>) => void;
  videoQualityId: number; audioQualityId: number; codecId: number;
  setQuality: (v: number) => void; setAudio: (v: number) => void; setCodec: (v: number) => void;
}) {
  const qualities = media?.qualities ?? [];
  const audioQ = media?.audioQualities ?? [];
  const codecs = media?.qualities[0]?.codecs ?? [];
  return (
    <div className="dl-pane" data-tab="media">
      <div className="dl-card">
        <div className="dl-card-title">媒体信息</div>
        {loading ? <div className="muted small">加载媒体候选…</div>
          : error ? <div className="muted small">加载失败：{error}</div>
          : <div className="muted small">已获取可选的画质/音质/编码（来自真实媒体探测）</div>}
        <div className="dl-selects">
          <label className="dl-field">
            <span>画质</span>
            <select value={videoQualityId} onChange={(e) => setQuality(Number(e.target.value))}>
              <option value={0}>Auto（按优先级）</option>
              {qualities.map((q) => <option key={q.id} value={q.id}>{q.label}</option>)}
            </select>
          </label>
          <label className="dl-field">
            <span>音质</span>
            <select value={audioQualityId} onChange={(e) => setAudio(Number(e.target.value))}>
              <option value={0}>Auto（按优先级）</option>
              {audioQ.map((q) => <option key={q.id} value={q.id}>{q.label}</option>)}
            </select>
          </label>
          <label className="dl-field">
            <span>编码</span>
            <select value={codecId} onChange={(e) => setCodec(Number(e.target.value))}>
              <option value={0}>Auto（按优先级）</option>
              {codecs.map((cc) => <option key={cc.id} value={cc.id}>{cc.label}</option>)}
            </select>
          </label>
          {media?.timelength ? <div className="muted small">时长 {fmtDuration(media.timelength)} · 总大小估算中…</div> : null}
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

function AdditionalPane({ form, patchForm }: {
  form: { danmaku: boolean; subtitle: boolean; cover: boolean; chapter: boolean; metadata: boolean };
  patchForm: (p: Partial<{ danmaku: boolean; subtitle: boolean; cover: boolean; chapter: boolean; metadata: boolean }>) => void;
}) {
  return (
    <div className="dl-pane" data-tab="additional">
      <div className="dl-card">
        <div className="dl-card-title">附加文件</div>
        <ToggleRow label="弹幕" checked={form.danmaku} onChange={(v) => patchForm({ danmaku: v })} />
        <ToggleRow label="字幕" checked={form.subtitle} onChange={(v) => patchForm({ subtitle: v })} />
        <ToggleRow label="封面" checked={form.cover} onChange={(v) => patchForm({ cover: v })} />
        <ToggleRow label="章节" checked={form.chapter} onChange={(v) => patchForm({ chapter: v })} />
        <ToggleRow label="元数据" checked={form.metadata} onChange={(v) => patchForm({ metadata: v })} />
      </div>
    </div>
  );
}

function DownloadPane() {
  return (
    <div className="dl-pane" data-tab="download">
      <div className="dl-card">
        <div className="dl-card-title">下载设置</div>
        <div className="muted small">输出容器默认 MP4；命名规则与编号沿用全局设置（P4 完整接入）。</div>
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

function anyExtra(form: { video: boolean; audio: boolean; danmaku: boolean; subtitle: boolean; cover: boolean; chapter: boolean; metadata: boolean }): boolean {
  return form.video || form.audio || form.danmaku || form.subtitle || form.cover || form.chapter || form.metadata;
}

function buildChips(form: { video: boolean; audio: boolean; merge: boolean; danmaku: boolean; subtitle: boolean; cover: boolean; chapter: boolean; metadata: boolean }): string[] {
  const chips: string[] = [];
  if (form.video) chips.push("video");
  if (form.audio) chips.push("audio");
  if (form.danmaku) chips.push("danmaku");
  if (form.subtitle) chips.push("subtitle");
  if (form.cover) chips.push("cover");
  if (form.chapter) chips.push("chapter");
  if (form.metadata) chips.push("metadata");
  return chips;
}

function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}