import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api.js";
import type { AppConfig, AppConfigPatch, ExtrasOptions, NamingRule } from "../types.js";
import { Icon } from "../components/icons.js";
import { cn } from "../utils.js";

interface SettingsViewProps {
  config: AppConfig;
  onConfigChange: (config: AppConfig) => void;
  onToast: (message: string, tone?: "success" | "error") => void;
}

const RULE_TYPE_LABELS: Record<number, string> = {
  11: "普通视频",
  12: "分 P 视频",
  13: "合集",
  14: "互动视频",
  20: "番剧",
  30: "课程",
  31: "课程章节",
  40: "收藏夹",
  50: "UP 主空间",
  60: "历史记录",
  70: "稍后再看",
  80: "每周必看",
  90: "音乐",
};

function Section({ number, title, description, children }: { number: string; title: string; description: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <div className="section-heading"><span className="section-index">{number}</span><div><h3>{title}</h3><p>{description}</p></div></div>
      <div className="settings-card">{children}</div>
    </section>
  );
}

function Field({ label, hint, children, wide }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return <label className={cn("settings-field", wide && "is-wide")}><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</label>;
}

function SwitchRow({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <button type="button" className={cn("switch-row", disabled && "is-disabled")} disabled={disabled} onClick={() => onChange(!checked)}><span className="switch-copy"><span>{label}</span>{hint ? <small>{hint}</small> : null}</span><span className={cn("switch", checked && "is-on")}><span /></span></button>;
}

function Select({ value, onChange, children }: { value: string | number; onChange: (value: string) => void; children: ReactNode }) {
  return <select value={String(value)} onChange={(event) => onChange(event.target.value)}>{children}</select>;
}

function ensureExtras(additional: ExtrasOptions | undefined): ExtrasOptions {
  const source = additional ?? {};
  return {
    danmaku: { ...(source.danmaku ?? {}), enabled: source.danmaku?.enabled ?? false, format: source.danmaku?.format ?? "ass", embed: source.danmaku?.embed ?? false, deleteAfterEmbed: source.danmaku?.deleteAfterEmbed ?? false },
    subtitle: { ...(source.subtitle ?? {}), enabled: source.subtitle?.enabled ?? false, format: source.subtitle?.format ?? "ass", embed: source.subtitle?.embed ?? false, deleteAfterEmbed: source.subtitle?.deleteAfterEmbed ?? false },
    cover: { ...(source.cover ?? {}), enabled: source.cover?.enabled ?? false, format: source.cover?.format ?? "jpg", attach: source.cover?.attach ?? false, deleteAfterAttach: source.cover?.deleteAfterAttach ?? false },
    chapter: { embed: source.chapter?.embed ?? false },
    metadata: { enabled: source.metadata?.enabled ?? false, format: source.metadata?.format ?? "nfo" },
  };
}

export function SettingsView({ config, onConfigChange, onToast }: SettingsViewProps) {
  const [local, setLocal] = useState<AppConfig>(() => ({ ...config, additional: ensureExtras(config.additional) }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setLocal({ ...config, additional: ensureExtras(config.additional) });
  }, [config]);

  const patchDownload = (patch: Partial<AppConfig["download"]>) => setLocal((current) => ({ ...current, download: { ...current.download, ...patch } }));
  const patchBehavior = (patch: Partial<AppConfig["behavior"]>) => setLocal((current) => ({ ...current, behavior: { ...current.behavior, ...patch } }));
  const patchAdvancedNumber = (key: "defaultVideoQualityId" | "defaultAudioQualityId" | "defaultCodecId", raw: string) => setLocal((current) => { const advanced = { ...current.advanced }; const value = raw.replace(/\D/g, ""); if (value) Object.assign(advanced, { [key]: Number(value) }); else delete advanced[key]; return { ...current, advanced }; });
  const patchAdvancedString = (key: "ffmpegPath" | "proxy", raw: string) => setLocal((current) => { const advanced = { ...current.advanced }; if (raw) Object.assign(advanced, { [key]: raw }); else delete advanced[key]; return { ...current, advanced }; });
  const patchExtra = <K extends keyof ExtrasOptions>(key: K, patch: Partial<NonNullable<ExtrasOptions[K]>>) => {
    setLocal((current) => ({ ...current, additional: { ...current.additional, [key]: { ...(current.additional[key] ?? {}), ...patch } as ExtrasOptions[K] } }));
  };
  const patchRule = (id: string, patch: Partial<NamingRule>) => setLocal((current) => ({ ...current, fileNaming: { ...current.fileNaming, rules: current.fileNaming.rules.map((rule) => rule.id === id ? { ...rule, ...patch } : rule) } }));

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const patch: AppConfigPatch = {
        additional: local.additional,
        fileNaming: local.fileNaming,
        download: local.download,
        behavior: local.behavior,
        advanced: local.advanced,
      };
      const next = await api.updateConfig(patch);
      onConfigChange(next);
      onToast("设置已保存", "success");
    } catch (err) {
      const message = err instanceof Error ? err.message : "设置保存失败";
      setError(message);
      onToast(message, "error");
    } finally {
      setSaving(false);
    }
  };

  const addRule = () => {
    const next: NamingRule = { id: `custom-${Date.now()}`, name: "自定义规则", type: 11, rule: "{uploader}/{pub_time:%Y-%m-%d}_{title}", default: false };
    setLocal((current) => ({ ...current, fileNaming: { ...current.fileNaming, rules: [...current.fileNaming.rules, next] } }));
  };

  return (
    <div className="view-stack">
      <section className="hero-panel hero-panel-small">
        <div className="hero-copy"><p className="eyebrow">CONTROL CENTER</p><h1>设置 <em>让下载符合你的习惯。</em></h1><p className="hero-description">下载行为、附加内容、命名规则和高级网络选项都会保存到 NAS 数据目录。</p></div>
        <button className="button button-primary save-button" type="button" onClick={() => void save()} disabled={saving}><Icon name={saving ? "retry" : "check"} size={16} className={saving ? "spin" : ""} /> {saving ? "保存中..." : "保存设置"}</button>
      </section>

      {error ? <div className="inline-error"><Icon name="info" size={16} /> {error}</div> : null}

      <Section number="01" title="下载行为" description="控制默认落盘目录、并发、限速和重复内容策略。">
        <div className="settings-grid">
          <Field label="下载目录" hint="留空使用服务端默认下载目录" wide><input value={local.download.dir} onChange={(event) => patchDownload({ dir: event.target.value })} placeholder="/volume1/docker/bili23-web/data/downloads" /></Field>
          <Field label="并行任务数"><input inputMode="numeric" value={local.download.parallel} onChange={(event) => patchDownload({ parallel: Math.max(1, Math.min(16, Number(event.target.value) || 1)) })} /></Field>
          <Field label="单任务分片"><input inputMode="numeric" value={local.download.threads} onChange={(event) => patchDownload({ threads: Math.max(1, Math.min(16, Number(event.target.value) || 1)) })} /></Field>
          <Field label="全局限速 KB/s" hint="0 表示不限速"><input inputMode="numeric" value={local.download.speedLimitKbps} onChange={(event) => patchDownload({ speedLimitKbps: Math.max(0, Number(event.target.value) || 0) })} /></Field>
          <Field label="重名策略"><Select value={local.download.renamePolicy} onChange={(value) => patchDownload({ renamePolicy: value as "auto" | "overwrite" })}><option value="auto">自动改名</option><option value="overwrite">覆盖</option></Select></Field>
          <Field label="重复下载"><Select value={local.download.duplicatePolicy} onChange={(value) => patchDownload({ duplicatePolicy: value as "prompt" | "skip" | "force" })}><option value="prompt">提示我</option><option value="skip">跳过</option><option value="force">强制下载</option></Select></Field>
          <Field label="默认容器"><Select value={local.download.defaultContainer} onChange={(value) => patchDownload({ defaultContainer: value as "mp4" | "mkv" })}><option value="mp4">MP4</option><option value="mkv">MKV</option></Select></Field>
        </div>
      </Section>

      <Section number="02" title="界面与默认值" description="设置主题、语言以及默认画质、音质和编码。">
        <div className="settings-grid">
          <Field label="主题"><Select value={local.behavior.theme} onChange={(value) => patchBehavior({ theme: value as "light" | "dark" | "system" })}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></Select></Field>
          <Field label="语言"><Select value={local.behavior.language} onChange={(value) => patchBehavior({ language: value as "zh-CN" | "zh-TW" | "en" | "system" })}><option value="system">跟随系统</option><option value="zh-CN">简体中文</option><option value="zh-TW">繁體中文</option><option value="en">English</option></Select></Field>
          <Field label="默认画质 ID" hint="留空使用自动选择"><input inputMode="numeric" value={local.advanced.defaultVideoQualityId ?? ""} onChange={(event) => patchAdvancedNumber("defaultVideoQualityId", event.target.value)} /></Field>
          <Field label="默认音质 ID" hint="留空使用自动选择"><input inputMode="numeric" value={local.advanced.defaultAudioQualityId ?? ""} onChange={(event) => patchAdvancedNumber("defaultAudioQualityId", event.target.value)} /></Field>
          <Field label="默认编码 ID" hint="留空使用自动选择"><input inputMode="numeric" value={local.advanced.defaultCodecId ?? ""} onChange={(event) => patchAdvancedNumber("defaultCodecId", event.target.value)} /></Field>
        </div>
      </Section>

      <Section number="03" title="附加内容" description="设置每次下载时默认附带的弹幕、字幕、封面、章节和元数据。">
        <div className="extras-settings">
          <div className="extra-card"><SwitchRow label="下载弹幕" checked={local.additional.danmaku?.enabled ?? false} onChange={(enabled) => patchExtra("danmaku", { enabled })} />{local.additional.danmaku?.enabled ? <Select value={local.additional.danmaku.format} onChange={(value) => patchExtra("danmaku", { format: value as "ass" | "xml" | "json" })}><option value="ass">ASS</option><option value="xml">XML</option><option value="json">JSON</option></Select> : null}</div>
          <div className="extra-card"><SwitchRow label="下载字幕" checked={local.additional.subtitle?.enabled ?? false} onChange={(enabled) => patchExtra("subtitle", { enabled })} />{local.additional.subtitle?.enabled ? <Select value={local.additional.subtitle.format} onChange={(value) => patchExtra("subtitle", { format: value as "ass" | "srt" | "lrc" | "txt" | "json" })}><option value="ass">ASS</option><option value="srt">SRT</option><option value="lrc">LRC</option><option value="txt">TXT</option><option value="json">JSON</option></Select> : null}</div>
          <div className="extra-card"><SwitchRow label="下载封面" checked={local.additional.cover?.enabled ?? false} onChange={(enabled) => patchExtra("cover", { enabled })} />{local.additional.cover?.enabled ? <Select value={local.additional.cover.format} onChange={(value) => patchExtra("cover", { format: value as "jpg" | "png" | "webp" | "avif" })}><option value="jpg">JPG</option><option value="png">PNG</option><option value="webp">WEBP</option><option value="avif">AVIF</option></Select> : null}</div>
          <div className="extra-card"><SwitchRow label="章节信息" checked={local.additional.chapter?.embed ?? false} onChange={(embed) => patchExtra("chapter", { embed })} /></div>
          <div className="extra-card"><SwitchRow label="元数据" checked={local.additional.metadata?.enabled ?? false} onChange={(enabled) => patchExtra("metadata", { enabled })} />{local.additional.metadata?.enabled ? <Select value={local.additional.metadata.format} onChange={(value) => patchExtra("metadata", { format: value as "nfo" | "json" })}><option value="nfo">NFO</option><option value="json">JSON</option></Select> : null}</div>
        </div>
      </Section>

      <Section number="04" title="命名与编号" description="按内容类型管理文件名模板；模板中的变量会在任务创建时展开。">
        <div className="settings-card-inner">
          <div className="settings-grid compact-grid">
            <Field label="编号方式"><Select value={local.fileNaming.numberingType} onChange={(value) => setLocal((current) => ({ ...current, fileNaming: { ...current.fileNaming, numberingType: Number(value) } }))}><option value="0">使用起始编号</option><option value="1">使用本次解析顺序</option><option value="2">连续编号</option></Select></Field>
            <Field label="起始编号"><input inputMode="numeric" value={local.fileNaming.startingNumber} onChange={(event) => setLocal((current) => ({ ...current, fileNaming: { ...current.fileNaming, startingNumber: Math.max(0, Number(event.target.value) || 0) } }))} /></Field>
          </div>
          <div className="rule-list">
            {local.fileNaming.rules.map((rule) => (
              <div className="rule-row" key={rule.id}>
                <div className="rule-row-head"><strong>{rule.name}</strong><span>{RULE_TYPE_LABELS[rule.type] ?? `类型 ${rule.type}`}</span>{rule.default ? <em>默认</em> : null}</div>
                <input value={rule.rule} onChange={(event) => patchRule(rule.id, { rule: event.target.value })} />
                <div className="rule-row-actions">
                  <input className="rule-name-input" value={rule.name} onChange={(event) => patchRule(rule.id, { name: event.target.value })} />
                  <button className="icon-button icon-button-danger" type="button" onClick={() => setLocal((current) => ({ ...current, fileNaming: { ...current.fileNaming, rules: current.fileNaming.rules.filter((entry) => entry.id !== rule.id) } }))}><Icon name="trash" size={15} /></button>
                </div>
              </div>
            ))}
          </div>
          <button className="button button-ghost" type="button" onClick={addRule}><Icon name="sparkles" size={15} /> 新增命名规则</button>
        </div>
      </Section>

      <Section number="05" title="高级网络" description="CDN 节点、ffmpeg 路径和代理配置；修改后会应用到新任务。">
        <div className="settings-grid">
          <Field label="CDN 节点" hint="每行一个主机名，留空自动选择" wide><textarea rows={3} value={local.advanced.cdnHosts.join("\n")} onChange={(event) => setLocal((current) => ({ ...current, advanced: { ...current.advanced, cdnHosts: event.target.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) } }))} placeholder="upos-sz-mirror.bilivideo.com" /></Field>
          <Field label="ffmpeg 路径" hint="留空使用系统 PATH"><input value={local.advanced.ffmpegPath ?? ""} onChange={(event) => patchAdvancedString("ffmpegPath", event.target.value)} placeholder="/usr/bin/ffmpeg" /></Field>
          <Field label="代理地址" hint="例如 http://127.0.0.1:7890"><input value={local.advanced.proxy ?? ""} onChange={(event) => patchAdvancedString("proxy", event.target.value)} placeholder="留空不使用代理" /></Field>
        </div>
      </Section>
    </div>
  );
}