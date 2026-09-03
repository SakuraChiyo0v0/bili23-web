import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { AppConfig, DanmakuStyle, DownloadOptions, ExtrasOptions, MediaOptionSummary, SubtitleStyle } from "../types.js";
import { Icon } from "./icons.js";
import { cn, subtitleLanguageLabel, SUBTITLE_LANGUAGES, DEFAULT_DANMAKU_STYLE, DEFAULT_SUBTITLE_STYLE } from "../utils.js";
import { StyleEditor } from "./StyleEditor.js";

interface DownloadOptionsProps {
  config: AppConfig;
  media: MediaOptionSummary | undefined;
  selectedCount: number;
  onCancel: () => void;
  onSubmit: (options: DownloadOptions) => void;
  onToast: (message: string, tone?: "success" | "error") => void;
}

const FORMAT_OPTIONS: Record<string, Array<{ value: string; label: string }>> = {
  danmaku: [
    { value: "ass", label: "ASS" },
    { value: "xml", label: "XML" },
    { value: "json", label: "JSON" },
  ],
  subtitle: [
    { value: "ass", label: "ASS" },
    { value: "srt", label: "SRT" },
    { value: "lrc", label: "LRC" },
    { value: "txt", label: "TXT" },
    { value: "json", label: "JSON" },
  ],
  cover: [
    { value: "jpg", label: "JPG" },
    { value: "png", label: "PNG" },
    { value: "webp", label: "WEBP" },
    { value: "avif", label: "AVIF" },
  ],
  metadata: [
    { value: "nfo", label: "NFO" },
    { value: "json", label: "JSON" },
  ],
};

function initialExtras(config: AppConfig): ExtrasOptions {
  const additional = config.additional ?? {};
  return {
    danmaku: {
      ...(additional.danmaku ?? {}),
      enabled: additional.danmaku?.enabled ?? false,
      format: additional.danmaku?.format ?? "ass",
      style: { ...DEFAULT_DANMAKU_STYLE, ...(additional.danmaku?.style ?? {}) },
      embed: additional.danmaku?.embed ?? false,
      deleteAfterEmbed: additional.danmaku?.deleteAfterEmbed ?? false,
    },
    subtitle: {
      ...(additional.subtitle ?? {}),
      enabled: additional.subtitle?.enabled ?? false,
      format: additional.subtitle?.format ?? "ass",
      language: additional.subtitle?.language
        ? { downloadSpecified: additional.subtitle.language.downloadSpecified ?? false, specifiedLanguages: additional.subtitle.language.specifiedLanguages ?? [] }
        : { downloadSpecified: false, specifiedLanguages: [] },
      style: { ...DEFAULT_SUBTITLE_STYLE, ...(additional.subtitle?.style ?? {}) },
      embed: additional.subtitle?.embed ?? false,
      deleteAfterEmbed: additional.subtitle?.deleteAfterEmbed ?? false,
    },
    cover: {
      ...(additional.cover ?? {}),
      enabled: additional.cover?.enabled ?? false,
      format: additional.cover?.format ?? "jpg",
      attach: additional.cover?.attach ?? false,
      deleteAfterAttach: additional.cover?.deleteAfterAttach ?? false,
    },
    chapter: {
      embed: additional.chapter?.embed ?? false,
    },
    metadata: {
      enabled: additional.metadata?.enabled ?? false,
      format: additional.metadata?.format ?? "nfo",
    },
  };
}

function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("field", className)}>
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

function SwitchRow({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" className={cn("switch-row", disabled && "is-disabled")} disabled={disabled} onClick={() => onChange(!checked)}>
      <span className="switch-copy">
        <span>{label}</span>
        {hint ? <small>{hint}</small> : null}
      </span>
      <span className={cn("switch", checked && "is-on")}><span /></span>
    </button>
  );
}

function Select({ value, onChange, children, disabled }: { value: string | number; onChange: (value: string) => void; children: ReactNode; disabled?: boolean }) {
  return <select disabled={disabled} value={String(value)} onChange={(event) => onChange(event.target.value)}>{children}</select>;
}

export function DownloadOptions({ config, media, selectedCount, onCancel, onSubmit, onToast }: DownloadOptionsProps) {
  const defaults = useMemo(() => initialExtras(config), [config]);
  const [extras, setExtras] = useState<ExtrasOptions>(defaults);
  const [quality, setQuality] = useState<string>("auto");
  const [audio, setAudio] = useState<string>("auto");
  const [codec, setCodec] = useState<string>("auto");
  const [container, setContainer] = useState<string>(config.download.defaultContainer);
  const [downloadVideo, setDownloadVideo] = useState(true);
  const [downloadAudio, setDownloadAudio] = useState(true);
  const [mergeVideoAudio, setMergeVideoAudio] = useState(true);
  const [keepOriginal, setKeepOriginal] = useState(false);
  const [ruleId, setRuleId] = useState<string>(config.fileNaming.rules.find((rule) => rule.default)?.id ?? "");
  const [number, setNumber] = useState<string>("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showDanmakuStyle, setShowDanmakuStyle] = useState(false);
  const [showSubtitleStyle, setShowSubtitleStyle] = useState(false);

  useEffect(() => {
    setExtras(initialExtras(config));
    setContainer(config.download.defaultContainer);
  }, [config]);

  useEffect(() => {
    if (!media) {
      setQuality("auto");
      setAudio("auto");
      setCodec("auto");
      return;
    }
    setQuality(String(media.qualities[0]?.id ?? "auto"));
    setAudio(String(media.audioQualities[0]?.id ?? "auto"));
    setCodec(String(media.qualities[0]?.codecs[0]?.id ?? "auto"));
  }, [media]);

  const codecOptions = useMemo(() => {
    if (!media) return [];
    return media.qualities.find((entry) => String(entry.id) === quality)?.codecs ?? [];
  }, [media, quality]);

  const patchExtra = <K extends keyof ExtrasOptions>(key: K, patch: Partial<NonNullable<ExtrasOptions[K]>>) => {
    setExtras((current) => ({
      ...current,
      [key]: { ...(current[key] ?? {}), ...patch } as ExtrasOptions[K],
    }));
  };

  /** 勾选/取消一个字幕语言：切换指定语言集合与 downloadSpecified 开关 */
  const toggleSubtitleLanguage = (lan: string) => {
    const current = extras.subtitle?.language ?? { downloadSpecified: false, specifiedLanguages: [] };
    const has = (current.specifiedLanguages ?? []).includes(lan);
    const next = has
      ? (current.specifiedLanguages ?? []).filter((entry) => entry !== lan)
      : [...(current.specifiedLanguages ?? []), lan];
    patchExtra("subtitle", { language: { downloadSpecified: next.length > 0, specifiedLanguages: next } });
  };

  const selectedSubtitleLanguages = extras.subtitle?.language?.specifiedLanguages ?? [];

  const submit = () => {
    const numericQuality = quality === "auto" ? undefined : Number(quality);
    const numericAudio = audio === "auto" ? undefined : Number(audio);
    const numericCodec = codec === "auto" ? undefined : Number(codec);
    const selectedRule = config.fileNaming.rules.find((rule) => rule.id === ruleId);
    const payload: DownloadOptions = {
      ...(numericQuality === undefined ? {} : { videoQualityId: numericQuality }),
      ...(numericAudio === undefined ? {} : { audioQualityId: numericAudio }),
      ...(numericCodec === undefined ? {} : { videoCodecId: numericCodec }),
      container: container === "mkv" ? "mkv" : "mp4",
      downloadVideo,
      downloadAudio,
      mergeVideoAudio,
      keepOriginalFiles: keepOriginal,
      extras,
      ...(selectedRule
        ? {
            naming: {
              conventionType: selectedRule.type,
              rule: selectedRule.rule,
              number: number === "" ? "" : Number(number),
            },
          }
        : {}),
    };
    onSubmit(payload);
    onToast(`已创建 ${selectedCount} 个下载任务`, "success");
  };

  return (
    <div className="drawer-backdrop" role="presentation">
      <section className="download-drawer" role="dialog" aria-modal="true" aria-label="下载设置">
        <header className="drawer-header">
          <div>
            <p className="eyebrow">DOWNLOAD OPTIONS</p>
            <h2>下载设置</h2>
            <p className="muted">已选择 <strong>{selectedCount}</strong> 个条目，下面的设置将固化到本次任务。</p>
          </div>
          <button className="icon-button" type="button" onClick={onCancel} aria-label="关闭下载设置"><Icon name="close" /></button>
        </header>

        <div className="drawer-content">
          <section className="drawer-section">
            <div className="section-heading"><span className="section-index">01</span><div><h3>媒体设置</h3><p>按当前条目可用的流自动选择，也可以手动指定。</p></div></div>
            <div className="form-grid">
              <Field label="视频画质">
                <Select value={quality} onChange={setQuality}>
                  <option value="auto">自动（推荐）</option>
                  {media?.qualities.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
                </Select>
              </Field>
              <Field label="视频编码">
                <Select value={codec} onChange={setCodec} disabled={codecOptions.length === 0}>
                  <option value="auto">自动</option>
                  {codecOptions.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
                </Select>
              </Field>
              <Field label="音频音质">
                <Select value={audio} onChange={setAudio}>
                  <option value="auto">自动</option>
                  {media?.audioQualities.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
                </Select>
              </Field>
              <Field label="输出容器" hint={container === "mkv" ? "支持弹幕/字幕轨内嵌" : "兼容性优先"}>
                <div className="segmented">
                  <button type="button" className={container === "mp4" ? "is-active" : ""} onClick={() => setContainer("mp4")}>MP4</button>
                  <button type="button" className={container === "mkv" ? "is-active" : ""} onClick={() => setContainer("mkv")}>MKV</button>
                </div>
              </Field>

            <div className="media-stream-grid">
              <SwitchRow label="下载视频流" hint="关闭则仅下载音频" checked={downloadVideo} onChange={setDownloadVideo} />
              <SwitchRow label="下载音频流" hint="关闭则仅下载视频" checked={downloadAudio} onChange={setDownloadAudio} />
              <SwitchRow label="合并音视频" hint="开启则合成一个文件；关闭则视频/音频分开落盘" checked={mergeVideoAudio} onChange={(v) => { setMergeVideoAudio(v); if (!v) setKeepOriginal(false); }} disabled={!(downloadVideo && downloadAudio)} />
              <SwitchRow label="保留原始分片" hint="合并后保留原始 m4s 分片文件" checked={keepOriginal} onChange={setKeepOriginal} disabled={!(mergeVideoAudio && downloadVideo && downloadAudio)} />
            </div>
            </div>
          </section>

          <section className="drawer-section">
            <div className="section-heading"><span className="section-index">02</span><div><h3>附加文件</h3><p>选择需要随媒体一起保存的辅助内容。</p></div></div>
            <div className="extras-grid">
              <div className="extra-card">
                <SwitchRow label="弹幕" hint="可输出为 ASS、XML 或 JSON" checked={extras.danmaku?.enabled ?? false} onChange={(enabled) => patchExtra("danmaku", { enabled })} />
                {extras.danmaku?.enabled ? (
                  <div className="inline-controls">
                    <Select value={extras.danmaku.format} onChange={(value) => patchExtra("danmaku", { format: value as "ass" | "xml" | "json" })}>
                      {FORMAT_OPTIONS.danmaku?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </Select>
                    <SwitchRow label="内嵌 MKV" checked={extras.danmaku.embed ?? false} onChange={(embed) => patchExtra("danmaku", { embed })} disabled={container !== "mkv"} />
                    {extras.danmaku.embed ? <SwitchRow label="内嵌后删除源文件" checked={extras.danmaku.deleteAfterEmbed ?? false} onChange={(deleteAfter) => patchExtra("danmaku", { deleteAfterEmbed: deleteAfter })} disabled={container !== "mkv"} /> : null}
                    {extras.danmaku.format === "ass" ? (
                      <button type="button" className="text-button" onClick={() => setShowDanmakuStyle((v) => !v)}>
                        <Icon name={showDanmakuStyle ? "close" : "filter"} size={15} />
                        {showDanmakuStyle ? "收起样式" : "自定义样式"}
                      </button>
                    ) : null}
                    {extras.danmaku.format === "ass" && showDanmakuStyle ? (
                      <StyleEditor kind="danmaku" style={extras.danmaku.style ?? DEFAULT_DANMAKU_STYLE} onChange={(style) => patchExtra("danmaku", { style: style as DanmakuStyle })} />
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="extra-card">
                <SwitchRow label="字幕" hint="优先下载可用语言轨道" checked={extras.subtitle?.enabled ?? false} onChange={(enabled) => patchExtra("subtitle", { enabled })} />
                {extras.subtitle?.enabled ? (
                  <div className="inline-controls">
                    <Select value={extras.subtitle.format} onChange={(value) => patchExtra("subtitle", { format: value as "ass" | "srt" | "lrc" | "txt" | "json" })}>
                      {FORMAT_OPTIONS.subtitle?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </Select>
                    <div className="language-picker">
                      <span className="language-picker-title">指定语言</span>
                      <div className="language-chips">
                        {SUBTITLE_LANGUAGES.map((lang) => {
                          const selected = selectedSubtitleLanguages.includes(lang.lan);
                          return <button key={lang.lan} type="button" className={cn("language-chip", selected && "is-on")} onClick={() => toggleSubtitleLanguage(lang.lan)}>{lang.label}</button>;
                        })}
                      </div>
                      <span className="language-picker-hint">{subtitleLanguageLabel(selectedSubtitleLanguages[0] ?? "zh")} 等 {selectedSubtitleLanguages.length} 种</span>
                    </div>
                    <SwitchRow label="内嵌 MKV" checked={extras.subtitle.embed ?? false} onChange={(embed) => patchExtra("subtitle", { embed })} disabled={container !== "mkv"} />
                    {extras.subtitle.embed ? <SwitchRow label="内嵌后删除源文件" checked={extras.subtitle.deleteAfterEmbed ?? false} onChange={(deleteAfter) => patchExtra("subtitle", { deleteAfterEmbed: deleteAfter })} disabled={container !== "mkv"} /> : null}
                    {extras.subtitle.format === "ass" ? (
                      <button type="button" className="text-button" onClick={() => setShowSubtitleStyle((v) => !v)}>
                        <Icon name={showSubtitleStyle ? "close" : "filter"} size={15} />
                        {showSubtitleStyle ? "收起样式" : "自定义样式"}
                      </button>
                    ) : null}
                    {extras.subtitle.format === "ass" && showSubtitleStyle ? (
                      <StyleEditor kind="subtitle" style={extras.subtitle.style ?? DEFAULT_SUBTITLE_STYLE} onChange={(style) => patchExtra("subtitle", { style: style as SubtitleStyle })} />
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="extra-card">
                <SwitchRow label="封面" checked={extras.cover?.enabled ?? false} onChange={(enabled) => patchExtra("cover", { enabled })} />
                {extras.cover?.enabled ? (
                  <div className="inline-controls">
                    <Select value={extras.cover.format} onChange={(value) => patchExtra("cover", { format: value as "jpg" | "png" | "webp" | "avif" })}>
                      {FORMAT_OPTIONS.cover?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </Select>
                    <SwitchRow label="附进媒体" checked={extras.cover.attach ?? false} onChange={(attach) => patchExtra("cover", { attach })} disabled={container !== "mp4"} />
                    {extras.cover.attach ? <SwitchRow label="附进后删除源图片" checked={extras.cover.deleteAfterAttach ?? false} onChange={(deleteAfter) => patchExtra("cover", { deleteAfterAttach: deleteAfter })} disabled={container !== "mp4"} /> : null}
                  </div>
                ) : null}
              </div>
              <div className="extra-card">
                <SwitchRow label="元数据 NFO" checked={extras.metadata?.enabled ?? false} onChange={(enabled) => patchExtra("metadata", { enabled })} />
                {extras.metadata?.enabled ? (
                  <div className="inline-controls">
                    <Select value={extras.metadata.format} onChange={(value) => patchExtra("metadata", { format: value as "nfo" | "json" })}>
                      {FORMAT_OPTIONS.metadata?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </Select>
                  </div>
                ) : null}
              </div>
              <div className="extra-card">
                <SwitchRow label="章节信息" hint="写入可识别的章节文件" checked={extras.chapter?.embed ?? false} onChange={(embed) => patchExtra("chapter", { embed })} />
              </div>
            </div>
          </section>

          <section className="drawer-section">
            <div className="section-heading"><span className="section-index">03</span><div><h3>下载设置</h3><p>控制文件落盘位置、命名和编号方式。</p></div></div>
            <div className="form-grid">
              <Field label="命名规则" hint="当前类型可使用对应的默认规则">
                <Select value={ruleId} onChange={setRuleId}>
                  {config.fileNaming.rules.map((rule) => <option key={rule.id} value={rule.id}>{rule.name}</option>)}
                </Select>
              </Field>
              <Field label="起始编号" hint="留空则使用全局编号策略">
                <input inputMode="numeric" value={number} onChange={(event) => setNumber(event.target.value.replace(/\D/g, ""))} placeholder="自动" />
              </Field>
            </div>
            <button className="text-button" type="button" onClick={() => setShowAdvanced((value) => !value)}>
              <Icon name={showAdvanced ? "close" : "filter"} size={16} />
              {showAdvanced ? "收起高级选项" : "展开高级选项"}
            </button>
            {showAdvanced ? (
              <div className="advanced-note"><Icon name="info" size={16} /> 全局下载目录、并发数、限速和重复策略在「设置」中管理。</div>
            ) : null}
          </section>
        </div>

        <footer className="drawer-footer">
          <button className="button button-ghost" type="button" onClick={onCancel}>取消</button>
          <button className="button button-primary" type="button" onClick={submit}><Icon name="download" size={16} /> 创建下载任务</button>
        </footer>
      </section>
    </div>
  );
}