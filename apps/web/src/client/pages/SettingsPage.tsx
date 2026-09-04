import { useEffect, useState } from "react";
import { ThemeSwitcher } from "../components/ThemeSwitcher";
import { NamingRuleEditor, CONVENTION_TYPES } from "../components/NamingRuleEditor";
import { CdnEditor } from "../components/CdnEditor";
import { StyleEditor } from "../components/StyleEditor";
import { useSettingsStore } from "../store/useSettingsStore";
import { listDirs } from "../services/client";

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
      <BehaviorGroup config={config} onPatch={patch} />
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
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <Group title="下载">
      <Row label="下载目录" desc="留空 = 默认下载目录（NAS 容器内路径，如 /data/downloads）" control={
        <span className="dir-picker-row">
          <input className="text-input" style={{ width: 260 }} value={d.dir} placeholder="默认下载目录" onChange={(e) => onPatch({ download: { dir: e.target.value } })} />
          <button type="button" className="btn sm" onClick={() => setPickerOpen(true)}>浏览…</button>
        </span>
      }/>
      <DirPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        value={d.dir}
        onPick={(dir) => onPatch({ download: { dir } })}
      />
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

function BehaviorGroup({ config, onPatch }: { config: any; onPatch: (p: any) => void }) {
  const b = config.behavior;
  return (
    <Group title="解析与行为">
      <Row label="保存解析历史" desc="关闭后新解析不再写入解析历史" control={
        <Toggle checked={b.saveParseHistory} onChange={(v) => onPatch({ behavior: { saveParseHistory: v } })} />
      } />
      <Row label="下载前弹出下载选项框" desc="关闭后点“下载选中项”直接按默认选项创建任务" control={
        <Toggle checked={b.showDownloadOptionsDialog} onChange={(v) => onPatch({ behavior: { showDownloadOptionsDialog: v } })} />
      } />
      <Row label="解析列表设置" desc="列显隐/交替行色/悬浮条（原版功能，Web 端暂未实现）" control={<span className="small muted">未实现</span>} />
      <Row label="剪贴板监控 / 窗口行为 / 排序偏好" desc="桌面专属，Web 端暂不支持" control={<span className="small muted">—</span>} />
    </Group>
  );
}

function AdditionalGroup({ config, onPatch }: { config: any; onPatch: (p: any) => void }) {
  const a = config.additional || {};
  const [styleKind, setStyleKind] = useState<"" | "danmaku" | "subtitle">("");
  const patch = (extra: string, patchObj: any) => onPatch({ additional: { [extra]: patchObj } });
  const patchD = (patchObj: any) => patch("danmaku", { ...a.danmaku, ...patchObj });
  const patchS = (patchObj: any) => patch("subtitle", { ...a.subtitle, ...patchObj });
  const patchC = (patchObj: any) => patch("cover", { ...a.cover, ...patchObj });
  const patchM = (patchObj: any) => patch("metadata", { ...a.metadata, ...patchObj });
  return (
    <Group title="附加内容">
      <div className="panel-sep">弹幕</div>
      <Row label="下载弹幕" desc="" control={<Toggle checked={a.danmaku?.enabled} onChange={(v) => patchD({ enabled: v })} />} />
      {a.danmaku?.enabled && (
        <>
          <Row label="弹幕格式" desc="输出格式" control={
            <select className="text-input" style={{ width: 140 }} value={a.danmaku?.format ?? "ass"} onChange={(e) => patchD({ format: e.target.value })}>
              <option value="xml">XML</option><option value="ass">ASS</option><option value="json">JSON</option>
            </select>
          } />
          <Row label="弹幕样式" desc="仅 ASS 生效" control={<button type="button" className="btn sm ghost" onClick={() => setStyleKind("danmaku")}>自定义…</button>} />
          <Row label="嵌入视频" desc="作为字幕轨，需 ASS + MKV" control={<Toggle checked={a.danmaku?.embed} onChange={(v) => patchD({ embed: v })} />} />
          {a.danmaku?.embed && (
            <Row label="嵌入后删除源文件" desc="" control={<Toggle checked={a.danmaku?.deleteAfterEmbed} onChange={(v) => patchD({ deleteAfterEmbed: v })} />} />
          )}
        </>
      )}
      <div className="panel-sep">字幕</div>
      <Row label="下载字幕" desc="" control={<Toggle checked={a.subtitle?.enabled} onChange={(v) => patchS({ enabled: v })} />} />
      {a.subtitle?.enabled && (
        <>
          <Row label="字幕格式" desc="输出格式" control={
            <select className="text-input" style={{ width: 140 }} value={a.subtitle?.format ?? "ass"} onChange={(e) => patchS({ format: e.target.value })}>
              <option value="srt">SRT</option><option value="lrc">LRC</option><option value="txt">TXT</option>
              <option value="ass">ASS</option><option value="json">JSON</option>
            </select>
          } />
          <Row label="字幕样式" desc="仅 ASS 生效" control={<button type="button" className="btn sm ghost" onClick={() => setStyleKind("subtitle")}>自定义…</button>} />
          <Row label="嵌入视频" desc="作为字幕轨，需 ASS + MKV" control={<Toggle checked={a.subtitle?.embed} onChange={(v) => patchS({ embed: v })} />} />
          {a.subtitle?.embed && (
            <Row label="嵌入后删除源文件" desc="" control={<Toggle checked={a.subtitle?.deleteAfterEmbed} onChange={(v) => patchS({ deleteAfterEmbed: v })} />} />
          )}
        </>
      )}
      <div className="panel-sep">封面</div>
      <Row label="下载封面" desc="" control={<Toggle checked={a.cover?.enabled} onChange={(v) => patchC({ enabled: v })} />} />
      {a.cover?.enabled && (
        <>
          <Row label="封面格式" desc="" control={
            <select className="text-input" style={{ width: 140 }} value={a.cover?.format ?? "jpg"} onChange={(e) => { const format = e.target.value; patchC({ format, attach: format === "avif" ? false : a.cover?.attach }); }}>
              <option value="jpg">JPG</option><option value="png">PNG</option>
              <option value="avif">AVIF</option><option value="webp">WEBP</option>
            </select>
          } />
          <Row label="嵌入封面" desc="AVIF 不支持嵌入" control={<Toggle checked={a.cover?.attach} onChange={(v) => patchC({ attach: v })} />} />
          {a.cover?.attach && (
            <Row label="嵌入后删除源图片" desc="" control={<Toggle checked={a.cover?.deleteAfterAttach} onChange={(v) => patchC({ deleteAfterAttach: v })} />} />
          )}
        </>
      )}
      <div className="panel-sep">章节 / 元数据</div>
      <Row label="内嵌章节信息" desc="合并时生效" control={<Toggle checked={a.chapter?.embed} onChange={(v) => patch("chapter", { ...a.chapter, embed: v })} />} />
      <Row label="下载元数据" desc="" control={<Toggle checked={a.metadata?.enabled} onChange={(v) => patchM({ enabled: v })} />} />
      {a.metadata?.enabled && (
        <Row label="元数据格式" desc="" control={
          <select className="text-input" style={{ width: 140 }} value={a.metadata?.format ?? "nfo"} onChange={(e) => patchM({ format: e.target.value })}>
            <option value="nfo">NFO</option><option value="json">JSON</option>
          </select>
        } />
      )}
      <StyleEditor open={!!styleKind} onClose={() => setStyleKind("")} kind={styleKind || "danmaku"}
        value={(styleKind === "subtitle" ? a.subtitle?.style : a.danmaku?.style) as any}
        onChange={(sv: any) => {
          if (styleKind === "subtitle") patchS({ style: sv });
          else patchD({ style: sv });
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

function DirPicker({ open, onClose, value, onPick }: { open: boolean; onClose: () => void; value: string; onPick: (dir: string) => void }) {
  const [current, setCurrent] = useState<string>(value || "/");
  const [dirs, setDirs] = useState<Array<{ name: string; path: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [manual, setManual] = useState(value || "");

  useEffect(() => {
    if (!open) return;
    setCurrent(value || "/");
    setManual(value || "");
    setError("");
  }, [open, value]);

  useEffect(() => {
    if (!open || !current) return;
    setLoading(true);
    setError("");
    listDirs(current)
      .then((r) => setDirs(r.dirs))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [open, current]);

  if (!open) return null;

  const up = () => {
    const trimmed = current.replace(/[\\/]+$/, "");
    const idx = trimmed.lastIndexOf("/");
    if (idx > 0) setCurrent(trimmed.slice(0, idx));
    else if (trimmed.length > 0) setCurrent("/");
  };
  const enter = (path: string) => { setCurrent(path); setManual(path); };
  const confirmPick = () => { const dir = manual.trim().replace(/[\\/]+$/, "") || "/"; onPick(dir); onClose(); };

  return (
    <div className="overlay sheet-on-mobile center-mobile" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal md">
        <div className="modal-head">
          <div className="modal-title">选择下载目录</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            <svg className="ico" viewBox="0 0 24 24" width={18} height={18}><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="modal-body">
          <div className="dir-picker-current">
            <button type="button" className="btn sm ghost" onClick={up} disabled={current === "/"}>↑ 上级</button>
            <code className="dir-current-path">{current}</code>
          </div>
          <div className="dir-picker-list">
            {loading && <p className="muted small">加载中…</p>}
            {error && <p className="danger small">读取失败：{error}</p>}
            {!loading && !error && dirs.length === 0 && <p className="muted small">此目录没有可选的子目录</p>}
            {dirs.map((d) => (
              <button key={d.path} type="button" className="dir-row" onClick={() => enter(d.path)}>
                <svg className="ico" viewBox="0 0 24 24" width={16} height={16}><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z" /></svg>
                <span>{d.name}</span>
              </button>
            ))}
          </div>
          <div className="dir-picker-tip"><span className="small muted">点击目录进入子目录，路径会同步到底部输入框。</span></div>
        </div>
        <div className="modal-foot">
          <div className="dir-picker-manual">
            <input className="text-input" style={{ flex: 1 }} value={manual} onChange={(e) => setManual(e.target.value)} placeholder="或直接输入 NAS 容器内路径" />
          </div>
          <div className="right">
            <button type="button" className="btn" onClick={onClose}>取消</button>
            <button type="button" className="btn primary" onClick={confirmPick}>使用此目录</button>
          </div>
        </div>
      </div>
    </div>
  );
}
