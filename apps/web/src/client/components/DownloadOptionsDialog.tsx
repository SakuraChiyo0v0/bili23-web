import { useEffect, useRef, useState } from "react";
import { mediaOptions, createTasks } from "../services/client";
import { DuplicateDialog } from "./DuplicateDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { Overlay } from "./Overlay";
import { validateDownloadForm } from "../lib/downloadValidation";
import { CODEC_NOTE, audioCodecName, estimateSize, fmtBitrate, fmtFrameRate, noAudioReason } from "../lib/mediaText";
import { getCurrentLang } from "../lib/i18n";
import { stepDuplicates } from "../lib/duplicateQueue";
import { StyleEditor, type StyleValues } from "./StyleEditor";
import { useDownloadOptions, formToExtras, type ExtraOptionState, type DanmakuFormat, type SubtitleFormat, type CoverFormat, type MetadataFormat } from "../store/useDownloadOptions";
import { useSettingsStore } from "../store/useSettingsStore";
import { useTasksStore } from "../store/useTasksStore";
import { useToast } from "../lib/toast";
import { Icon } from "../lib/icons";
import { SubtitleLanguageDialog } from "./SubtitleLanguageDialog";
import { GuideDialog } from "./GuideDialog";
import { MEDIA_INFO_GUIDE, MEDIA_OPTIONS_GUIDE, NUMBERING_GUIDE } from "../lib/guides";
import { DirPicker } from "./DirPicker";
import { PriorityDialog } from "./PriorityDialog";
import { DEFAULT_PRIORITY, PRIORITY_KEY, type PriorityKind } from "../lib/priorityMaps";
import type { MediaOptionSummary, AppConfigPatch, AppConfig } from "../services/types";
import { t as tr } from "../lib/i18n";

export function DownloadOptionsDialog() {
  const {
    open, items, media, mediaLoading, mediaError, form,
    videoQualityId, audioQualityId, codecId, container,
    close, setMedia, setMediaLoading, setMediaError, patchForm, setQuality, setAudio, setCodec, setContainer,
  } = useDownloadOptions();
  const { toast, toastLong } = useToast();
  const setTasks = useTasksStore((s) => s.setTasks);
  const settingsCfg = useSettingsStore((st) => st.config);
  const settingsLoad = useSettingsStore((st) => st.load);
  const saveConfig = useSettingsStore((st) => st.save);
  const [dupQueue, setDupQueue] = useState<Array<{ itemId: string; title: string }>>([]);
  const dupHead = dupQueue[0] ?? null;
  /**
   * 校验用的 MessageBox（原版 `dialog.py:60-75` 与 `media.py:92-115` 三处）。
   * `then: "proceed"` 表示"确定后继续建任务"，不设则是纯提示（原版 `hideCancelButton()`）。
   */
  const [notice, setNotice] = useState<{
    title: string;
    body: string;
    confirmText?: string;
    cancelText?: string;
    then?: "proceed";
  } | null>(null);
  const [activeTab, setActiveTab] = useState("media");
  // 样式编辑弹窗（kind + 当前值）
  const [styleKind, setStyleKind] = useState<"" | "danmaku" | "subtitle">("");
  // 字幕语言选择弹窗
  const [langOpen, setLangOpen] = useState(false);
  // 本次任务命名规则（undefined = 沿用全局设置默认）
  const [namingRuleId, setNamingRuleId] = useState<string | undefined>(undefined);
  // 下载路径卡的草稿：原版是在「确定」时才写回全局（`download.py:38-41`），取消不留痕
  const [dirDraft, setDirDraft] = useState<string>("");
  const dirInited = useRef(false);
  // 编号设置卡（原版 NumberSettingCard：编号方式 + 全局顺序起始编号）
  const [numberingGuideOpen, setNumberingGuideOpen] = useState(false);
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

  // 下载路径卡初值：等同原版 `DownloadPathSettingCard.__init__` 里的 `set_path(config.download_path)`。
  // 配置是异步到达的，所以等到有 config 再初始化一次；每次重新打开对话框都重新取。
  useEffect(() => {
    if (!open) { dirInited.current = false; return; }
    if (dirInited.current || !settingsCfg) return;
    dirInited.current = true;
    setDirDraft(settingsCfg.download?.dir ?? "");
  }, [open, settingsCfg]);

  // 打开时拉取首个条目的媒体候选
  useEffect(() => {
    if (!open || !items.length) return;
    setMediaLoading(true);
    mediaOptions(items[0]!.id)
      .then((m) => setMedia(m))
      .catch((e) => setMediaError(e instanceof Error ? e.message : String(e)));
  }, [open, items, setMedia, setMediaLoading, setMediaError]);

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
      // 下载路径卡：显式带上，保证本次任务就落在用户刚选的目录（同时下面会写回全局）
      ...(dirDraft.trim() !== "" ? { downloadDir: dirDraft.trim() } : {}),
    };
    useDownloadOptions.getState().setResolved(options);
  };

  const confirm = async () => {
    // 三条校验都按原版做成**阻塞式 MessageBox**（`dialog.py:60-75`、`media.py:92-115`），
    // 而不是 toast —— toast 不阻断，用户还没看清就已经建完任务了。
    // 文案与"取消=不继续"的语义在 `lib/downloadValidation.ts`（纯函数 + 单测）。
    const v = validateDownloadForm({ video: form.video, audio: form.audio, merge: form.merge, hasExtra: anyExtra(form) });
    if (v.kind === "notice") {
      setNotice({ title: v.title, body: v.body });
      return;
    }
    if (v.kind === "confirm") {
      setNotice({ title: v.title, body: v.body, confirmText: v.confirmText, cancelText: v.cancelText, then: "proceed" });
      return;
    }
    await doCreate();
  };

  /** 真正建任务（校验与确认都过了才会走到这里） */
  const doCreate = async () => {
    // 下载路径卡：原版在 `accept()` 里才 `config.set(download_path, ...)`，取消不留痕
    if (settingsCfg && dirDraft !== (settingsCfg.download?.dir ?? "")) {
      await saveConfig({ download: { dir: dirDraft } } as AppConfigPatch);
    }
    buildOptions();
    const resolved = useDownloadOptions.getState().resolved;
    const ids = items.map((i) => i.id);
    /**
     * 重复项的两种收场：
     * - 策略=询问 → 排队**逐条问**（原版 DuplicateDownloadDialog）；
     * - 策略=跳过 → **静默跳过**并提示，绝不弹询问框
     *   （文案取原版 `已跳过重复下载的任务：{task_title}`，`zh_CN.ts:1054`）。
     *
     * ⚠️ 服务端对"全部重复"一律返 409 DUPLICATE（与策略无关），所以**不能只看 409 就弹窗** ——
     * 之前就是那样，导致用户选了"跳过下载"仍被追问（真机实测发现）。
     */
    const handleDuplicates = (dups: Array<{ itemId: string; title: string }>): void => {
      const policy = settingsCfg?.download?.duplicatePolicy ?? "prompt";
      if (policy === "prompt") {
        setDupQueue(dups);
        return; // 选项弹窗保持打开，重复弹窗挂在它下面（关掉选项弹窗会连带卸载重复弹窗）
      }
      toast(dups.length === 1 ? `已跳过重复下载的任务：${dups[0]!.title}` : `已跳过重复下载的任务：${dups.length} 个`, "warn");
      close();
    };
    try {
      const { tasks, duplicates } = await createTasks(ids, resolved);
      if (tasks.length) setTasks(tasks);
      if (tasks.length) toast(`已创建 ${tasks.length} 个下载任务`, "ok");
      if (duplicates.length) { handleDuplicates(duplicates); return; }
      close();
    } catch (e) {
      const err = e as Error & { code?: string; duplicates?: Array<{ itemId: string; title: string }> };
      if (err.code === "DUPLICATE" || (err.duplicates && err.duplicates.length)) {
        handleDuplicates(err.duplicates?.length ? err.duplicates : items.map((i) => ({ itemId: i.id, title: i.title })));
      } else {
        toastLong(tr("创建任务失败"), e instanceof Error ? e.message : String(e), "err");
      }
    }
  };

  /**
   * 逐条处理重复项（原版 `duplicate_download.py:37-53`）：
   * 「继续下载」= 强制建这条任务；「跳过下载」= 跳过这条。
   * 勾了「不再询问」→ 把全局重复策略改成 force/skip（原版 `config.set(duplicate_download_resolution, ...)`），
   * 剩下的同类项**不再问**，直接按同一决定批量处理。
   */
  const resolveDuplicates = async (continueDownload: boolean, neverAsk: boolean) => {
    const step = stepDuplicates(dupQueue, continueDownload, neverAsk);
    const resolved = useDownloadOptions.getState().resolved;

    // 勾了「不再询问」→ 先写回全局策略（下一批就不再问了）
    if (step.policy) {
      await saveConfig({ download: { duplicatePolicy: step.policy } } as AppConfigPatch);
    }

    if (step.force.length > 0) {
      try {
        const { tasks } = await createTasks(step.force, resolved, true);
        if (tasks.length) setTasks([...useTasksStore.getState().tasks, ...tasks]);
        toast(step.force.length > 1 ? `已继续下载 ${tasks.length} 个重复项` : `已继续下载：${dupHead?.title ?? ""}`, "ok");
      } catch (e) {
        toast("继续下载失败：" + (e instanceof Error ? e.message : String(e)), "err");
      }
    } else if (step.skip.length > 0) {
      toast(step.skip.length > 1 ? `已跳过 ${step.skip.length} 个重复项` : `已跳过：${dupHead?.title ?? ""}`, "warn");
    }
    if (step.policy) toast(`重复下载策略已改为「${step.policy === "force" ? tr("继续下载") : tr("跳过下载")}」`, "ok");

    setDupQueue(step.rest);
    if (step.done) close();
  };

  const chips = buildChips(form);

  return (
    <Overlay open={open} onClose={close} size="lg" sheetOnMobile className="dl-options">
        <div className="modal-head">
          <div className="modal-title">{tr("下载选项")}</div>
          <button type="button" className="icon-btn" onClick={close} aria-label={tr("关闭")}>
            <svg className="ico" viewBox="0 0 24 24" width={18} height={18}><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="tabs-nav">
          <button type="button" className={`tab${activeTab === "media" ? " active" : ""}`} onClick={() => setActiveTab("media")}>{tr("媒体设置")}</button>
          <button type="button" className={`tab${activeTab === "additional" ? " active" : ""}`} onClick={() => setActiveTab("additional")}>{tr("附加文件")}</button>
          <button type="button" className={`tab${activeTab === "download" ? " active" : ""}`} onClick={() => setActiveTab("download")}>{tr("下载设置")}</button>
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
              namingChoices={namingChoices}
              dirDraft={dirDraft} setDirDraft={setDirDraft}
              videoSelected={form.video}
              config={settingsCfg}
              onPatchConfig={(p) => void saveConfig(p)}
              onOpenNumberingGuide={() => setNumberingGuideOpen(true)} />
          )}
        </div>
        <div className="dl-footer">
          <div className="dl-preview">
            {chips.length ? chips.map((c) => <span key={c} className={`tag ${c}`}>{c}</span>) : <span className="tag none">{tr("未选择内容")}</span>}
          </div>
          <div className="dl-footer-actions">
            <button type="button" className="btn" onClick={close}>{tr("取消")}</button>
            <button type="button" className="btn primary" onClick={confirm}>{tr("确定")}</button>
          </div>
        </div>
      {/* 校验 MessageBox（A4/A5 可取消、A6 仅提示）—— 挂在下载选项弹窗之上 */}
      <ConfirmDialog
        open={notice !== null}
        title={notice?.title ?? ""}
        body={notice?.body ?? ""}
        {...(notice?.confirmText !== undefined ? { confirmText: notice.confirmText } : {})}
        {...(notice?.cancelText !== undefined ? { cancelText: notice.cancelText } : {})}
        onConfirm={() => {
          const then = notice?.then;
          setNotice(null);
          if (then === "proceed") void doCreate();
        }}
        onCancel={() => setNotice(null)}
      />
      {/* 逐条询问重复项（原版 DuplicateDownloadDialog）；key 让换下一条时组件重挂、「不再询问」复位 */}
      {dupHead && (
        <DuplicateDialog
          key={dupHead.itemId}
          duplicate={dupHead}
          remaining={dupQueue.length}
          onContinue={(neverAsk) => void resolveDuplicates(true, neverAsk)}
          onSkip={(neverAsk) => void resolveDuplicates(false, neverAsk)}
        />
      )}
      {/* 「有关编号设置的说明」（原版 `card.py:435-442` 的超链接） */}
      <GuideDialog open={numberingGuideOpen} title={tr("有关编号设置的说明")} text={NUMBERING_GUIDE} onClose={() => setNumberingGuideOpen(false)} />
    </Overlay>
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
  // 没选具体画质（Auto）时，用**有效画质**的编码列表 —— 原版媒体信息卡显示的就是"当前会被选中"那一档的信息，空着没意义
  const codecs = (selQ ?? qualities[0])?.codecs ?? [];
  /** 两张卡的「说明」弹窗（原版 About Media Info / About Media Options） */
  const [guide, setGuide] = useState<"info" | "options" | null>(null);
  /** 齿轮打开的自定义优先级（写回 config，不是本次任务） */
  const [prioKind, setPrioKind] = useState<PriorityKind | null>(null);
  const appConfig = useSettingsStore((s) => s.config);
  const saveConfig = useSettingsStore((s) => s.save);
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
  const sizeBasis = selQ ? "" : (effQ ? `（${tr("按")} ${effQ.label} ${tr("估算")}）` : "");
  /** 副标题的分隔符：英文用 ", "（原版英文界面就是逗号+空格），中文用全角顿隔 */
  const detailSep = getCurrentLang() === "en" ? ", " : "，";
  /**
   * 「媒体信息来源」：`#{number} - {title}`（原版 `update_source_description`）。
   * 我们用本次条目的分P 序号与标题拼；批量下载时媒体信息只探测了首个条目，所以这行是必要的。
   */
  const srcItem = useDownloadOptions((s) => s.items[0]);
  const sourceLabel = srcItem ? `#${srcItem.page} - ${srcItem.title}` : "";
  /** 画质行副标题（原版：画质 / 帧率 / 码率 / 大小[ / MP4]） */
  const videoDetail = (() => {
    if (!effQ) return [];
    const q = qualities.find((x) => x.id === effQ.id) ?? effQ;
    return [
      q.label,
      fmtFrameRate(q.frameRate),
      fmtBitrate(q.videoBandwidth),
      estimateSize(q.size, q.videoBandwidth, media?.timelength ?? 0),
      media?.mediaType === "mp4" ? "MP4" : "",
    ].filter(Boolean);
  })();
  /** 音质行副标题（原版：音质 / 编码 / 码率 / 大小） */
  const audioDetail = (() => {
    if (!effA) return [];
    return [
      effA.label,
      audioCodecName(effA.audioCodecs),
      fmtBitrate(effA.audioBandwidth),
      estimateSize(undefined, effA.audioBandwidth, media?.timelength ?? 0),
    ].filter(Boolean);
  })();
  return (
    <div className="dl-pane" data-tab="media">
      <div className="dl-card">
        <div className="dl-card-title">{tr("媒体信息")}<button type="button" className="btn sm ghost" style={{ marginLeft: 10 }} onClick={() => setGuide("info")}>{tr("说明")}</button></div>
        {/* 媒体信息来源（原版 `update_source_description`）：批量下载时媒体信息只取一个条目，
            所以要把"取自哪个"写出来，否则用户看到的画质可能与自己要下的那条对不上。 */}
        {sourceLabel ? <div className="muted small">{tr("媒体信息来源")}：{sourceLabel}</div> : null}
        {media && <span className={`badge dl-type${media.mediaType === "dash" ? "" : " mp4"}`}>{media.mediaType === "dash" ? tr("DASH 流") : tr("单文件/MP4")}</span>}
        {loading ? <div aria-hidden="true"><div className="sk sk-line w60" /><div className="sk sk-line w80" /><div className="sk sk-line w40" /></div>
          : error ? <div className="muted small">{tr("加载失败：")}{error}</div>
          : null}
        <div className="dl-selects">
          <div className="dl-field-wrap">
          <label className="dl-field">
            <span>{tr("画质")}</span>
            <select value={videoQualityId} onChange={(e) => setQuality(Number(e.target.value))}>
              <option value={0}>{tr("Auto（按优先级）")}</option>
              {qualities.map((q) => <option key={q.id} value={q.id}>{q.label}{fmtBps(q.videoBandwidth) ? " · " + fmtBps(q.videoBandwidth) : ""}</option>)}
            </select>
            <button type="button" className="icon-btn sm" title={tr("自定义优先级")} aria-label={tr("自定义画质优先级")} onClick={() => setPrioKind("video")}><Icon name="gear" size={15} /></button>
          </label>
          {/* 画质行副标题（原版：画质 / 帧率 / 码率 / 大小，MP4 再补一个 MP4） */}
          <div className="dl-subtle muted small">
            {videoDetail.length ? videoDetail.join(detailSep) : media ? tr("未知画质") : ""}
          </div>
          </div>
          <div className="dl-field-wrap">
          <label className="dl-field">
            <span>{tr("音质")}</span>
            <select value={audioQualityId} onChange={(e) => setAudio(Number(e.target.value))}>
              <option value={0}>{tr("Auto（按优先级）")}</option>
              {audioQ.map((q) => <option key={q.id} value={q.id}>{q.label}{fmtBps(q.audioBandwidth) ? " · " + fmtBps(q.audioBandwidth) : ""}</option>)}
            </select>
            <button type="button" className="icon-btn sm" title={tr("自定义优先级")} aria-label={tr("自定义音质优先级")} onClick={() => setPrioKind("audio")}><Icon name="gear" size={15} /></button>
          </label>
          {/* 音质行副标题（原版：音质 / 编码 / 码率 / 大小）；没有音频流时给**原因**，不是空白 */}
          <div className="dl-subtle muted small">
            {audioQ.length === 0 ? tr(noAudioReason(media?.mediaType)) : (audioDetail.length ? audioDetail.join(detailSep) : tr("未知音质"))}
          </div>
          </div>
          <div className="dl-field-wrap">
          <label className="dl-field">
            <span>{tr("编码")}</span>
            <select value={codecId} onChange={(e) => setCodec(Number(e.target.value))}>
              <option value={0}>{tr("Auto（按优先级）")}</option>
              {codecs.map((cc) => <option key={cc.id} value={cc.id}>{cc.label}</option>)}
            </select>
            <button type="button" className="icon-btn sm" title={tr("自定义优先级")} aria-label={tr("自定义编码优先级")} onClick={() => setPrioKind("codec")}><Icon name="gear" size={15} /></button>
          </label>
          {/* 编码行副标题（原版：编码 / 说明——体积与兼容性） */}
          <div className="dl-subtle muted small">
            {(() => {
              const id = codecId > 0 ? codecId : (codecs[0]?.id ?? 0);
              const label = codecs.find((c) => c.id === id)?.label;
              const note = CODEC_NOTE[id];
              if (!label) return "";
              return [label, note ? tr(note) : ""].filter(Boolean).join(detailSep);
            })()}
          </div>
          </div>
          {media?.timelength ? <div className="muted small">{tr("时长")} {fmtDuration(media.timelength)}{sizeBytes ? ` · ${tr("约合")} ${fmtBytes(sizeBytes)}${sizeBasis}` : ""}</div> : null}
        </div>
      </div>
      {/* 齿轮 = 原版下载选项弹窗内的「自定义优先级」（`dialog/download_options/media.py:135-161`）：
          它写回的是 **config**（不是本次任务），所以这里直接走设置 store 的 save。 */}
      <GuideDialog open={guide === "info"} title={tr("有关媒体信息的说明")} text={MEDIA_INFO_GUIDE} onClose={() => setGuide(null)} />
      <GuideDialog open={guide === "options"} title={tr("有关媒体选项的说明")} text={MEDIA_OPTIONS_GUIDE} onClose={() => setGuide(null)} />
      <PriorityDialog
        kind={prioKind}
        value={prioKind ? (appConfig?.download?.[PRIORITY_KEY[prioKind]] ?? DEFAULT_PRIORITY[prioKind]) : []}
        onClose={() => setPrioKind(null)}
        onConfirm={(next) => {
          if (prioKind) void saveConfig({ download: { [PRIORITY_KEY[prioKind]]: next } } as AppConfigPatch);
          setPrioKind(null);
        }}
      />
      <div className="dl-card">
        <div className="dl-card-title">{tr("媒体选项")}<button type="button" className="btn sm ghost" style={{ marginLeft: 10 }} onClick={() => setGuide("options")}>{tr("说明")}</button></div>
        <ToggleRow label={tr("下载独立视频流")} checked={form.video} onChange={(v) => patchForm({ video: v })} />
        <ToggleRow label={tr("下载独立音频流")} checked={form.audio} onChange={(v) => patchForm({ audio: v })} />
        <ToggleRow label={tr("合并视频与音频")} checked={form.merge} disabled={!form.video || !form.audio} onChange={(v) => patchForm({ merge: v })} />
        <ToggleRow label={tr("保留原始文件")} checked={form.keep} disabled={!form.merge} onChange={(v) => patchForm({ keep: v })} />
        {form.keep && (
          <div className="dl-inline">
            <span>{tr("保留类型")}</span>
            <select value={form.keepType} onChange={(e) => patchForm({ keepType: e.target.value as "both" | "video" | "audio" })}>
              <option value="both">视频 + 音频</option>
              <option value="video">{tr("仅视频")}</option>
              <option value="audio">{tr("仅音频")}</option>
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
        <div className="dl-card-title">{tr("弹幕")}</div>
        <ToggleRow label={tr("下载弹幕")} checked={form.danmaku.enabled} onChange={(v) => patch({ danmaku: { ...form.danmaku, enabled: v } })} />
        {form.danmaku.enabled && (
          <div className="dl-extra-rows">
            <InlineSelect label={tr("格式")} value={form.danmaku.format} options={DANMAKU_FORMATS}
              onChange={(format) => patch({ danmaku: { ...form.danmaku, format } })} />
            <div className="dl-inline"><span>样式（仅 ASS 生效）</span>
              <button type="button" className="btn sm ghost" onClick={() => setStyleKind("danmaku")}>{tr("自定义…")}</button>
            </div>
            <ToggleRow label={`嵌入视频（作为字幕轨，需 ASS + ${canAssEmbed ? "MKV" : tr("容器切到 MKV")}）`}
              checked={form.danmaku.embed}
              disabled={!canAssEmbed || form.danmaku.format !== "ass"}
              onChange={(v) => patch({ danmaku: { ...form.danmaku, embed: v } })} />
            {form.danmaku.embed && canAssEmbed && form.danmaku.format === "ass" && (
              <ToggleRow label={tr("嵌入后删除源文件")} checked={form.danmaku.deleteAfterEmbed}
                onChange={(v) => patch({ danmaku: { ...form.danmaku, deleteAfterEmbed: v } })} />
            )}
          </div>
        )}
      </div>
      <div className="dl-card">
        <div className="dl-card-title">{tr("字幕")}</div>
        <ToggleRow label={tr("下载字幕")} checked={form.subtitle.enabled} onChange={(v) => patch({ subtitle: { ...form.subtitle, enabled: v } })} />
        {form.subtitle.enabled && (
          <div className="dl-extra-rows">
            <InlineSelect label={tr("格式")} value={form.subtitle.format} options={SUBTITLE_FORMATS}
              onChange={(format) => patch({ subtitle: { ...form.subtitle, format } })} />
            <div className="dl-inline"><span>{tr("语言")}</span>
              <button type="button" className="btn sm ghost" onClick={() => setLangOpen(true)}>
                {form.subtitle.language.downloadSpecified && form.subtitle.language.specifiedLanguages.length > 0
                  ? `指定 ${form.subtitle.language.specifiedLanguages.length} 种`
                  : "全部语言"}
              </button>
            </div>
            <div className="dl-inline"><span>样式（仅 ASS 生效）</span>
              <button type="button" className="btn sm ghost" onClick={() => setStyleKind("subtitle")}>{tr("自定义…")}</button>
            </div>
            <ToggleRow label={`嵌入视频（作为字幕轨，需 ASS + ${canAssEmbed ? "MKV" : tr("容器切到 MKV")}）`}
              checked={form.subtitle.embed}
              disabled={!canAssEmbed || form.subtitle.format !== "ass"}
              onChange={(v) => patch({ subtitle: { ...form.subtitle, embed: v } })} />
            {form.subtitle.embed && canAssEmbed && form.subtitle.format === "ass" && (
              <ToggleRow label={tr("嵌入后删除源文件")} checked={form.subtitle.deleteAfterEmbed}
                onChange={(v) => patch({ subtitle: { ...form.subtitle, deleteAfterEmbed: v } })} />
            )}
          </div>
        )}
      </div>
      <div className="dl-card">
        <div className="dl-card-title">{tr("封面")}</div>
        <ToggleRow label={tr("下载封面")} checked={form.cover.enabled} onChange={(v) => patch({ cover: { ...form.cover, enabled: v } })} />
        {form.cover.enabled && (
          <div className="dl-extra-rows">
            <InlineSelect label={tr("格式")} value={form.cover.format} options={COVER_FORMATS}
              onChange={(format) => {
                const next = { ...form.cover, format };
                if (format === "avif") next.attach = false;
                patch({ cover: next });
              }} />
            <ToggleRow label={tr("嵌入封面到视频文件")} checked={form.cover.attach} disabled={form.cover.format === "avif"}
              onChange={(v) => patch({ cover: { ...form.cover, attach: v } })} />
            {form.cover.attach && form.cover.format !== "avif" && (
              <ToggleRow label={tr("嵌入后删除源图片")} checked={form.cover.deleteAfterAttach}
                onChange={(v) => patch({ cover: { ...form.cover, deleteAfterAttach: v } })} />
            )}
          </div>
        )}
      </div>
      <div className="dl-card">
        <div className="dl-card-title">{tr("章节")}</div>
        <ToggleRow label={tr("嵌入章节信息（合并时生效）")} checked={form.chapter.embed}
          onChange={(v) => patch({ chapter: { embed: v } })} />
      </div>
      <div className="dl-card">
        <div className="dl-card-title">{tr("元数据")}</div>
        <ToggleRow label={tr("下载元数据（NFO 刮削）")} checked={form.metadata.enabled}
          onChange={(v) => patch({ metadata: { ...form.metadata, enabled: v } })} />
        {form.metadata.enabled && (
          <div className="dl-extra-rows">
            <InlineSelect label={tr("格式")} value={form.metadata.format} options={METADATA_FORMATS}
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


/** 页签 3「下载设置」—— 对齐原版 `DownloadSettingsPage`（`dialog/download_options/download.py:20-36`）：
 *  下载路径卡 → 下载格式卡 → 命名规则卡 → 自动显示此对话框 → 编号设置卡，顺序与原版一致。 */
function DownloadPane({
  container, setContainer, namingRuleId, setNamingRuleId, namingChoices,
  dirDraft, setDirDraft, videoSelected, config, onPatchConfig, onOpenNumberingGuide,
}: {
  container: "mp4" | "mkv";
  setContainer: (v: "mp4" | "mkv") => void;
  namingRuleId: string | undefined;
  setNamingRuleId: (v: string | undefined) => void;
  namingChoices: Array<{ id: string; name: string; type: number; rule: string }>;
  dirDraft: string;
  setDirDraft: (v: string) => void;
  /** 本次是否勾选了视频流（决定「将 M4A 转换为 MP3」是否可用） */
  videoSelected: boolean;
  config?: AppConfig;
  onPatchConfig: (p: AppConfigPatch) => void;
  onOpenNumberingGuide: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const numberingType = Number(config?.fileNaming?.numberingType ?? 0);
  const startingNumber = Number(config?.fileNaming?.startingNumber ?? 1);
  const showDialog = config?.behavior?.showDownloadOptionsDialog ?? true;
  return (
    <div className="dl-pane" data-tab="download">
      {/* 下载路径卡（原版 DownloadPathSettingCard）：只改「确定」时才写回的全局下载目录 */}
      <div className="dl-card">
        <div className="dl-card-title">{tr("下载路径")}</div>
        <div className="dl-field">
          <span>{tr("下载目录")}</span>
          <input className="text-input" style={{ flex: 1 }} value={dirDraft} placeholder={tr("默认下载目录")}
            onChange={(e) => setDirDraft(e.target.value)} />
          <button type="button" className="btn sm" onClick={() => setPickerOpen(true)}>{tr("选择文件夹")}</button>
        </div>
        <div className="muted small" style={{ marginTop: 6 }}>{tr("点击「确定」后才会保存该目录；取消不影响当前设置。")}</div>
        <DirPicker open={pickerOpen} onClose={() => setPickerOpen(false)} value={dirDraft} onPick={setDirDraft} />
      </div>
      {/* 下载格式卡（原版 DownloadFormatCard） */}
      <div className="dl-card">
        <div className="dl-card-title">{tr("下载格式")}</div>
        <div className="dl-field">
          <span>{tr("输出容器格式")}</span>
          <div className="seg">
            <button type="button" className={`seg-btn${container === "mp4" ? " active" : ""}`} onClick={() => setContainer("mp4")}>MP4</button>
            <button type="button" className={`seg-btn${container === "mkv" ? " active" : ""}`} onClick={() => setContainer("mkv")}>MKV</button>
          </div>
        </div>
        <ToggleRow label={tr("将 M4A 转换为 MP3（仅下载音频流时生效，勾选视频流时不可用）")}
          checked={config?.download?.m4aToMp3 ?? false} disabled={videoSelected}
          onChange={(v) => onPatchConfig({ download: { m4aToMp3: v } })} />
      </div>
      {/* 命名规则卡（原版 NamingConventionCard） */}
      <div className="dl-card">
        <div className="dl-card-title">{tr("命名规则")}</div>
        <label className="dl-field">
          <span>{tr("命名规则")}</span>
          <select className="text-input" value={namingRuleId ?? ""} onChange={(e) => setNamingRuleId(e.target.value || undefined)}>
            {namingChoices.map((r) => <option key={r.id || "global"} value={r.id}>{r.name}</option>)}
          </select>
        </label>
      </div>
      {/* 自动显示此对话框（原版 DownloadSettingsPage 里的 SwitchSettingCard，立即写回 config） */}
      <div className="dl-card">
        <div className="dl-card-title">{tr("自动显示此对话框")}</div>
        <ToggleRow label={tr("在开始下载前自动显示此对话框，以便自定义设置")} checked={showDialog}
          onChange={(v) => onPatchConfig({ behavior: { showDownloadOptionsDialog: v } })} />
      </div>
      {/* 编号设置卡（原版 NumberSettingCard） */}
      <div className="dl-card">
        <div className="dl-card-title">编号设置
          <button type="button" className="btn sm ghost" style={{ marginLeft: 10 }} onClick={onOpenNumberingGuide}>{tr("有关编号设置的说明")}</button>
        </div>
        <div className="dl-inline">
          <span>{tr("编号方式")}</span>
          <select className="text-input" value={numberingType} onChange={(e) => onPatchConfig({ fileNaming: { numberingType: Number(e.target.value) } })}>
            <option value={0}>{tr("每批次从1开始顺序编号")}</option>
            <option value={1}>{tr("使用解析列表中的序号")}</option>
            <option value={2}>{tr("全局顺序编号")}</option>
          </select>
        </div>
        <div className="dl-inline">
          <span className={numberingType === 2 ? "" : "muted"}>{tr("全局顺序起始编号")}</span>
          <input type="number" className="text-input" style={{ width: 120 }} min={1} value={startingNumber}
            disabled={numberingType !== 2}
            onChange={(e) => onPatchConfig({ fileNaming: { startingNumber: Number(e.target.value) } })} />
        </div>
        <div className="muted small" style={{ marginTop: 6 }}>
          设置全局顺序的起始编号，当前值：{startingNumber}
        </div>
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
