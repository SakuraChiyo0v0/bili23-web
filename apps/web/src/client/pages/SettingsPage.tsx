import { useEffect, useState } from "react";
import { ThemeSwitcher } from "../components/ThemeSwitcher";
import { NamingRuleEditor, CONVENTION_TYPES } from "../components/NamingRuleEditor";
import { CdnEditor } from "../components/CdnEditor";
import { StyleEditor } from "../components/StyleEditor";
import { useSettingsStore } from "../store/useSettingsStore";

export function SettingsPage() {
  const { config, loading, saved, error, load, save } = useSettingsStore();

  useEffect(() => { void load(); /*eslint-disable-next-line*/ }, []);

  if (loading && !config) return <div className="empty-state"><span className="spinner" /><p>加载设置…</p></div>;
  if (error && !config) return <div className="empty-state"><p className="muted">加载失败：{error}</p></div>;
  if (!config) return null;

  const patch = (p: Parameters<typeof save>[0]) => void save(p);

  return (
    <section className="page settings-page">
      <div className="page-head">
        <div className="panel-title">设置</div>
        <div className="spacer" />
        {saved && <span className="muted small">已保存</span>}
        {error && <span className="danger small">{error}</span>}
        <button type="button" className="btn sm" onClick={() => void load()} disabled={loading}>{loading ? "加载中…" : "重新加载"}</button>
      </div>

      <InterfaceGroup config={config} onPatch={patch} />
      <DownloadGroup config={config} onPatch={patch} />
      <BehaviorGroup onPatch={patch} />
      <AdditionalGroup config={config} onPatch={patch} />
      <NamingGroup config={config} onPatch={patch} />
      <AdvancedGroup config={config} onPatch={patch} />
    </section>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="settings-group">
      <h2>{title}</h2>
      <div className="panel">{children}</div>
    </div>
  );
}

function Row({ label, desc, control }: { label: string; desc?: string; control: React.ReactNode }) {
  return (
    <div className="setting-row">
      <div className="s-info">
        <div className="s-title">{label}</div>
        {desc && <div className="s-desc">{desc}</div>}
      </div>
      <div className="control">{control}</div>
    </div>
  );
}

function Seg({ value, options, onChange }: { value: string; options: Array<[string, string]>; onChange: (v: string) => void }) {
  return (
    <div className="seg">
      {options.map(([v, l]) => (
        <button key={v} className={`seg-btn${value === v ? " active" : ""}`} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  );
}

function InterfaceGroup({ config, onPatch }: { config: any; onPatch: (p: any) => void }) {
  const b = config.behavior;
  return (
    <Group title="界面">
      <Row label="主题" desc="浅色 / 深色 / 跟随系统（Web 端增强项）" control={
        <ThemeSwitcher value={b.theme} onChange={(v) => onPatch({ behavior: { theme: v } })} />
      }/>
      <Row label="语言" desc="界面语言（Web 首版中文）" control={
        <Seg value={b.language} options={[["system","系统默认"],["zh-CN","简体中文"],["zh-TW","繁體中文"],["en","English"]]} onChange={(v) => onPatch({ behavior: { language: v } })} />
      }/>
      <Row label="Mica 效果 / 显示缩放" desc="Windows 专属，Web 端不适用" control={<span className="small muted">—</span>} />
    </Group>
  );
}

function DownloadGroup({ config, onPatch }: { config: any; onPatch: (p: any) => void }) {
  const d = config.download;
  return (
    <Group title="下载">
      <Row label="下载目录" desc="留空 = 默认下载目录" control={
        <input className="text-input" style={{ width: 260 }} value={d.dir} placeholder="默认下载目录" onChange={(e) => onPatch({ download: { dir: e.target.value } })} />
      }/>
      <Row label="每任务线程数" desc="单任务分片并发（1–16）" control={
        <Slider value={d.threads} min={1} max={16} onChange={(v) => onPatch({ download: { threads: Number(v) } })} suffix="线程" />
      }/>
      <Row label="并行任务数" desc="同时下载几个任务（1–16）" control={
        <Slider value={d.parallel} min={1} max={16} onChange={(v) => onPatch({ download: { parallel: Number(v) } })} suffix="任务" />
      }/>
      <Row label="全局限速" desc="0 = 不限速（单位 KB/s）" control={
        <input type="number" className="text-input" style={{ width: 120 }} value={d.speedLimitKbps} min={0} onChange={(e) => onPatch({ download: { speedLimitKbps: Number(e.target.value) } })} />
      }/>
      <Row label="重名策略" desc="产物文件名冲突处理" control={
        <Seg value={d.renamePolicy} options={[["auto","自动重命名"],["overwrite","覆盖"]]} onChange={(v) => onPatch({ download: { renamePolicy: v } })} />
      }/>
      <Row label="重复下载处理" desc="已下载内容再次下载时" control={
        <Seg value={d.duplicatePolicy} options={[["prompt","总是询问"],["skip","跳过"],["force","强制下载"]]} onChange={(v) => onPatch({ download: { duplicatePolicy: v } })} />
      }/>
      <Row label="默认输出容器" desc="" control={
        <Seg value={d.defaultContainer} options={[["mp4","MP4"],["mkv","MKV"]]} onChange={(v) => onPatch({ download: { defaultContainer: v } })} />
      }/>
      <Row label="画质/音质/编码优先级" desc="拖拽排序（P4 简化：默认档位在高级组配置）" control={<span className="small muted">高级组设置默认档位</span>} />
    </Group>
  );
}

function BehaviorGroup({ onPatch }: { onPatch: (p: any) => void }) {
  return (
    <Group title="解析与行为">
      <Row label="保存解析历史" desc="解析过的链接是否入历史（Web 端默认开启）" control={<Toggle checked onChange={() => onPatch({})} />} />
      <Row label="下载前弹出下载选项框" desc="每次下载前显示下载选项弹窗" control={<Toggle checked onChange={() => onPatch({})} />} />
      <Row label="解析列表设置" desc="列显隐/交替行色/悬浮条（P6 细节打磨）" control={<span className="small muted">后续章节</span>} />
      <Row label="剪贴板监控 / 窗口行为 / 排序偏好" desc="桌面专属，Web 端暂不支持" control={<span className="small muted">—</span>} />
    </Group>
  );
}

function AdditionalGroup({ config, onPatch }: { config: any; onPatch: (p: any) => void }) {
  const a = config.additional || {};
  const [styleKind, setStyleKind] = useState<"" | "danmaku" | "subtitle">("");
  return (
    <Group title="附加内容">
      <Row label="弹幕" desc="下载弹幕" control={<><Toggle checked={a.danmaku?.enabled} onChange={(v) => onPatch({ additional: { danmaku: { ...a.danmaku, enabled: v } } })} /><button type="button" className="btn sm ghost" onClick={() => setStyleKind("danmaku")}>样式</button></>} />
      <Row label="字幕" desc="下载字幕" control={<><Toggle checked={a.subtitle?.enabled} onChange={(v) => onPatch({ additional: { subtitle: { ...a.subtitle, enabled: v } } })} /><button type="button" className="btn sm ghost" onClick={() => setStyleKind("subtitle")}>样式</button></>} />
      <Row label="封面" desc="下载封面" control={<Toggle checked={a.cover?.enabled} onChange={(v) => onPatch({ additional: { cover: { ...a.cover, enabled: v } } })} />} />
      <Row label="章节" desc="内嵌章节信息" control={<Toggle checked={a.chapter?.embed} onChange={(v) => onPatch({ additional: { chapter: { ...a.chapter, embed: v } } })} />} />
      <Row label="元数据" desc="下载元数据（NFO 刮削）" control={<Toggle checked={a.metadata?.enabled} onChange={(v) => onPatch({ additional: { metadata: { ...a.metadata, enabled: v } } })} />} />
    <StyleEditor open={!!styleKind} onClose={() => setStyleKind("")} kind={styleKind || "danmaku"} value={styleKind === "subtitle" ? a.subtitle?.style : a.danmaku?.style} onChange={(sv) => {
        if (styleKind === "subtitle") onPatch({ additional: { subtitle: { ...a.subtitle, style: sv } } });
        else onPatch({ additional: { danmaku: { ...a.danmaku, style: sv } } });
        useSettingsStore.getState().save({ additional: styleKind === "subtitle" ? { subtitle: { ...a.subtitle, style: sv } } : { danmaku: { ...a.danmaku, style: sv } } });
      }} />
    </Group>
  );
}

function NamingGroup({ config, onPatch }: { config: any; onPatch: (p: any) => void }) {
  const f = config.fileNaming;
  const rules = f.rules || [];
  const numbering = Number(f.numberingType);
  const [editorOpen, setEditorOpen] = useState(false);
  const saveRules = (next: any[]) => {
    onPatch({ fileNaming: { rules: next } });
    useSettingsStore.getState().save({ fileNaming: { rules: next } });
  };
  return (
    <Group title="命名规则">
      <Row label="命名规则" desc={`共 ${rules.length} 条规则`} control={
        <button type="button" className="btn sm" onClick={() => setEditorOpen(true)}>编辑</button>
      } />
      <div className="naming-list">
        {rules.map((r: any) => (
          <div key={r.id} className="naming-row">
            <span className="naming-name">{r.name}</span>
            <span className="naming-type">{CONVENTION_LABELS[r.type] ?? `分类 ${r.type}`}</span>
            <code className="naming-rule">{r.rule}</code>
          </div>
        ))}
      </div>
      <NamingRuleEditor open={editorOpen} onClose={() => setEditorOpen(false)} rules={rules} onChange={saveRules} />
      <Row label="编号模式" desc="FROM_SPECIFIED / USE_PARSE_LIST / CONTINUOUS" control={
        <Seg value={String(numbering)} options={[["0","批次从 1"],["1","用解析列表序号"],["2","全局连续"]]} onChange={(v) => onPatch({ fileNaming: { numberingType: Number(v) } })} />
      }/>
      <Row label="全局起始号" desc="CONTINUOUS / FROM_SPECIFIED 用" control={
        <input type="number" className="text-input" style={{ width: 120 }} value={f.startingNumber} min={1} onChange={(e) => onPatch({ fileNaming: { startingNumber: Number(e.target.value) } })} />
      }/>
    </Group>
  );
}

function AdvancedGroup({ config, onPatch }: { config: any; onPatch: (p: any) => void }) {
  const ad = config.advanced || {};
  const [cdnOpen, setCdnOpen] = useState(false);
  const saveCdnHosts = (next: any[]) => {
    onPatch({ advanced: { cdnHosts: next } });
    useSettingsStore.getState().save({ advanced: { cdnHosts: next } });
  };
  return (
    <Group title="高级">
      <Row label="默认画质档位" desc="缺省时不覆盖自动选择" control={
        <input type="number" className="text-input" style={{ width: 120 }} value={ad.defaultVideoQualityId ?? ""} placeholder="Auto" onChange={(e) => onPatch({ advanced: { defaultVideoQualityId: e.target.value ? Number(e.target.value) : undefined } })} />
      }/>
      <Row label="默认音质档位" desc="" control={
        <input type="number" className="text-input" style={{ width: 120 }} value={ad.defaultAudioQualityId ?? ""} placeholder="Auto" onChange={(e) => onPatch({ advanced: { defaultAudioQualityId: e.target.value ? Number(e.target.value) : undefined } })} />
      }/>
      <Row label="默认编码档位" desc="" control={
        <input type="number" className="text-input" style={{ width: 120 }} value={ad.defaultCodecId ?? ""} placeholder="Auto" onChange={(e) => onPatch({ advanced: { defaultCodecId: e.target.value ? Number(e.target.value) : undefined } })} />
      }/>
      <Row label="CDN 节点" desc="自定义服务商节点" control={<button type="button" className="btn sm" onClick={() => setCdnOpen(true)}>编辑</button>} />
      <CdnEditor open={cdnOpen} onClose={() => setCdnOpen(false)} hosts={ad.cdnHosts ?? []} onChange={saveCdnHosts} />
      <Row label="FFmpeg 路径" desc="自定义 FFmpeg" control={<input className="text-input" style={{ width: 260 }} value={ad.ffmpegPath ?? ""} placeholder="系统 PATH" onChange={(e) => onPatch({ advanced: { ffmpegPath: e.target.value || undefined } })} />} />
      <Row label="代理" desc="代理服务器地址" control={<input className="text-input" style={{ width: 260 }} value={ad.proxy ?? ""} placeholder="http://host:port" onChange={(e) => onPatch({ advanced: { proxy: e.target.value || undefined } })} />} />
      <Row label="MCP / 日志查看器 / 检查更新" desc="桌面专属，Web 端暂不支持" control={<span className="small muted">—</span>} />
    </Group>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return <input type="checkbox" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />;
}

function Slider({ value, min, max, onChange, suffix }: { value: number; min: number; max: number; onChange: (v: string) => void; suffix: string }) {
  return (
    <div className="slider-row">
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(e.target.value)} />
      <span className="slider-val">{value}{suffix}</span>
    </div>
  );
}
const CONVENTION_LABELS: Record<number, string> = Object.fromEntries(CONVENTION_TYPES.map((t) => [t.id, t.label]));