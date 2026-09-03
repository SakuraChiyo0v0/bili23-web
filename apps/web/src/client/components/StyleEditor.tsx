import type { ReactNode } from "react";
import type { DanmakuStyle, SubtitleStyle } from "../types.js";
import { cn } from "../utils.js";

interface StyleEditorProps {
  /** danmaku 或 subtitle */
  kind: "danmaku" | "subtitle";
  style: DanmakuStyle | SubtitleStyle;
  onChange: (style: DanmakuStyle | SubtitleStyle) => void;
}

function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("style-field", className)}>
      <span className="style-field-label">{label}</span>
      {children}
      {hint ? <span className="style-field-hint">{hint}</span> : null}
    </label>
  );
}

function NumInput({ value, onChange, min, max }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (Number.isFinite(n)) onChange(n);
      }}
    />
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" className={cn("style-toggle", checked && "is-on")} onClick={() => onChange(!checked)}>
      <span className="style-copy"><span>{label}</span></span>
      <span className="switch"><span /></span>
    </button>
  );
}

function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  // ASS color 形如 &H00AABBGGRR；这里仅暴露纯文本输入，避免颜色映射歧义
  return (
    <Field label={label} hint="ASS 颜色格式 &HAABBGGRR">
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="&H00FFFFFF" />
    </Field>
  );
}

/** 弹幕/字幕 ASS 样式编辑器（样式仅在 ASS 输出与内嵌时生效） */
export function StyleEditor({ kind, style, onChange }: StyleEditorProps) {
  const font = style.font;
  const border = style.border;
  const resolution = style.resolution;

  const s = style as DanmakuStyle | SubtitleStyle;
  const isDanmaku = kind === "danmaku";
  const advanced = isDanmaku ? (s as DanmakuStyle).advanced : undefined;

  const setFont = (patch: Partial<DanmakuStyle["font"]>) => onChange({ ...s, font: { ...font, ...patch } });
  const setBorder = (patch: Partial<DanmakuStyle["border"]>) => onChange({ ...s, border: { ...border, ...patch } });
  const setResolution = (patch: Partial<DanmakuStyle["resolution"]>) => onChange({ ...s, resolution: { ...resolution, ...patch } });

  return (
    <div className="style-editor">
      <div className="style-editor-section">
        <span className="style-editor-title">字体</span>
        <div className="style-grid">
          <Field label="字体名"><input value={font.name} onChange={(e) => setFont({ name: e.target.value })} placeholder="黑体" /></Field>
          <Field label="字号"><NumInput value={font.size} onChange={(v) => setFont({ size: Math.max(8, Math.min(120, Math.round(v))) })} min={8} max={120} /></Field>
        </div>
        <div className="style-toggles">
          <ToggleRow label="加粗" checked={font.bold} onChange={(v) => setFont({ bold: v })} />
          <ToggleRow label="斜体" checked={font.italic} onChange={(v) => setFont({ italic: v })} />
          <ToggleRow label="下划线" checked={font.underline} onChange={(v) => setFont({ underline: v })} />
          <ToggleRow label="删除线" checked={font.strike} onChange={(v) => setFont({ strike: v })} />
        </div>
      </div>

      <div className="style-editor-section">
        <span className="style-editor-title">描边与阴影</span>
        <div className="style-grid">
          <Field label="描边宽度"><NumInput value={border.border} onChange={(v) => setBorder({ border: Math.max(0, Math.min(20, v)) })} min={0} max={20} /></Field>
          <Field label="阴影深度"><NumInput value={border.shadow} onChange={(v) => setBorder({ shadow: Math.max(0, Math.min(20, v)) })} min={0} max={20} /></Field>
        </div>
      </div>

      {isDanmaku && advanced ? (
        <div className="style-editor-section">
          <span className="style-editor-title">弹幕高级</span>
          <div className="style-grid">
            <Field label="显示区域（%）"><NumInput value={advanced.displayArea} onChange={(v) => onChange({ ...s, advanced: { ...advanced, displayArea: Math.max(1, Math.min(100, v)) } })} min={1} max={100} /></Field>
            <Field label="不透明度（%）"><NumInput value={advanced.opacity} onChange={(v) => onChange({ ...s, advanced: { ...advanced, opacity: Math.max(0, Math.min(100, v)) } })} min={0} max={100} /></Field>
            <Field label="滚动时长（秒）"><NumInput value={advanced.scrollDuration} onChange={(v) => onChange({ ...s, advanced: { ...advanced, scrollDuration: Math.max(1, v) } })} min={1} /></Field>
            <Field label="静态时长（秒）"><NumInput value={advanced.staticDuration} onChange={(v) => onChange({ ...s, advanced: { ...advanced, staticDuration: Math.max(1, v) } })} min={1} /></Field>
            <Field label="最小间距（px）"><NumInput value={advanced.minimumGap} onChange={(v) => onChange({ ...s, advanced: { ...advanced, minimumGap: Math.max(0, v) } })} min={0} /></Field>
          </div>
        </div>
      ) : null}

      {!isDanmaku ? (
        <div className="style-editor-section">
          <span className="style-editor-title">字幕颜色与边距</span>
          <div className="style-grid">
            <ColorInput label="主色" value={(s as SubtitleStyle).color.primary} onChange={(v) => onChange({ ...s, color: { ...(s as SubtitleStyle).color, primary: v } })} />
            <ColorInput label="次要色" value={(s as SubtitleStyle).color.secondary} onChange={(v) => onChange({ ...s, color: { ...(s as SubtitleStyle).color, secondary: v } })} />
            <ColorInput label="描边色" value={(s as SubtitleStyle).color.border} onChange={(v) => onChange({ ...s, color: { ...(s as SubtitleStyle).color, border: v } })} />
            <ColorInput label="阴影色" value={(s as SubtitleStyle).color.shadow} onChange={(v) => onChange({ ...s, color: { ...(s as SubtitleStyle).color, shadow: v } })} />
            <Field label="左边距"><NumInput value={(s as SubtitleStyle).margin.left} onChange={(v) => onChange({ ...s, margin: { ...(s as SubtitleStyle).margin, left: Math.max(0, v) } })} min={0} /></Field>
            <Field label="右边距"><NumInput value={(s as SubtitleStyle).margin.right} onChange={(v) => onChange({ ...s, margin: { ...(s as SubtitleStyle).margin, right: Math.max(0, v) } })} min={0} /></Field>
            <Field label="垂直边距"><NumInput value={(s as SubtitleStyle).margin.vertical} onChange={(v) => onChange({ ...s, margin: { ...(s as SubtitleStyle).margin, vertical: Math.max(0, v) } })} min={0} /></Field>
            <Field label="对齐（ASS）"><NumInput value={(s as SubtitleStyle).alignment} onChange={(v) => onChange({ ...s, alignment: Math.max(1, Math.min(9, Math.round(v))) })} min={1} max={9} /></Field>
          </div>
        </div>
      ) : null}

      <div className="style-editor-section">
        <span className="style-editor-title">分辨率</span>
        <div className="style-grid">
          <Field label="宽"><NumInput value={resolution.width} onChange={(v) => setResolution({ width: Math.max(320, Math.round(v)) })} min={320} /></Field>
          <Field label="高"><NumInput value={resolution.height} onChange={(v) => setResolution({ height: Math.max(180, Math.round(v)) })} min={180} /></Field>
        </div>
      </div>
    </div>
  );
}
