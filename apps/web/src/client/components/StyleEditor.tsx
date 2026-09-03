import { useState } from "react";
import { useToast } from "../lib/toast";

interface FontCfg { name: string; size: number; bold: boolean; italic: boolean; underline: boolean; strike: boolean; }
interface BorderCfg { border: number; shadow: number; }
export interface StyleValues {
  font: FontCfg;
  border: BorderCfg;
  advanced?: { displayArea: number; opacity: number; scrollDuration: number; staticDuration: number; minimumGap: number };
  color?: { primary: string; secondary: string; border: string; shadow: string };
  margin?: { left: number; right: number; vertical: number };
  resolution?: { width: number; height: number };
  alignment?: number;
}

export function StyleEditor({
  open, onClose, kind, value, onChange,
}: {
  open: boolean; onClose: () => void;
  kind: "danmaku" | "subtitle";
  value?: StyleValues; onChange: (v: StyleValues) => void;
}) {
  const { toast } = useToast();
  const [v, setV] = useState<StyleValues>(value ?? blank(kind));

  if (!open) return null;
  const patch = (p: Partial<StyleValues>) => setV({ ...v, ...p });

  return (
    <div className="overlay sheet-on-mobile center-mobile" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal md style-editor">
        <div className="modal-head">
          <div className="modal-title">{kind === "danmaku" ? "弹幕样式" : "字幕样式"}</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭"><svg className="ico" viewBox="0 0 24 24" width={18} height={18}><path d="M6 6l12 12M18 6L6 18" /></svg></button>
        </div>
        <div className="modal-body style-body">
          <div className="style-grid">
            <label className="dl-field"><span>字体</span><input className="text-input" value={v.font.name} onChange={(e) => patch({ font: { ...v.font, name: e.target.value } })} /></label>
            <label className="dl-field"><span>字号</span><input type="number" className="text-input" value={v.font.size} onChange={(e) => patch({ font: { ...v.font, size: Number(e.target.value) } })} /></label>
            <label className="dl-field"><span>描边</span><input type="number" className="text-input" step="0.5" value={v.border.border} onChange={(e) => patch({ border: { ...v.border, border: Number(e.target.value) } })} /></label>
            <label className="dl-field"><span>阴影</span><input type="number" className="text-input" step="0.5" value={v.border.shadow} onChange={(e) => patch({ border: { ...v.border, shadow: Number(e.target.value) } })} /></label>
          </div>
          {v.font && (
            <div className="style-toggles">
              {(["bold", "italic", "underline", "strike"] as const).map((k) => (
                <label key={k} className="style-toggle"><input type="checkbox" className="switch" checked={v.font[k]} onChange={(e) => patch({ font: { ...v.font, [k]: e.target.checked } })} /><span>{{ bold: "粗体", italic: "斜体", underline: "下划线", strike: "删除线" }[k]}</span></label>
              ))}
            </div>
          )}
          {kind === "danmaku" && v.advanced && (
            <div className="style-grid">
              <label className="dl-field"><span>显示区域 %</span><input type="number" className="text-input" value={v.advanced.displayArea} onChange={(e) => patch({ advanced: { ...(v.advanced as NonNullable<typeof v.advanced>), displayArea: Number(e.target.value) } })} /></label>
              <label className="dl-field"><span>不透明度 %</span><input type="number" className="text-input" value={v.advanced.opacity} onChange={(e) => patch({ advanced: { ...(v.advanced as NonNullable<typeof v.advanced>), opacity: Number(e.target.value) } })} /></label>
              <label className="dl-field"><span>滚动时长 s</span><input type="number" className="text-input" step="0.5" value={v.advanced.scrollDuration} onChange={(e) => patch({ advanced: { ...(v.advanced as NonNullable<typeof v.advanced>), scrollDuration: Number(e.target.value) } })} /></label>
              <label className="dl-field"><span>停留时长 s</span><input type="number" className="text-input" step="0.5" value={v.advanced.staticDuration} onChange={(e) => patch({ advanced: { ...(v.advanced as NonNullable<typeof v.advanced>), staticDuration: Number(e.target.value) } })} /></label>
              <label className="dl-field"><span>最小间距</span><input type="number" className="text-input" value={v.advanced.minimumGap} onChange={(e) => patch({ advanced: { ...(v.advanced as NonNullable<typeof v.advanced>), minimumGap: Number(e.target.value) } })} /></label>
              <label className="dl-field"><span>分辨率 宽</span><input type="number" className="text-input" value={v.resolution?.width ?? 1280} onChange={(e) => patch({ resolution: { width: Number(e.target.value), height: v.resolution?.height ?? 720 } })} /></label>
              <label className="dl-field"><span>分辨率 高</span><input type="number" className="text-input" value={v.resolution?.height ?? 720} onChange={(e) => patch({ resolution: { width: v.resolution?.width ?? 1280, height: Number(e.target.value) } })} /></label>
            </div>
          )}
          {kind === "subtitle" && v.color && (
            <div className="style-grid">
              <label className="dl-field"><span>主色</span><input className="text-input" value={v.color.primary} onChange={(e) => patch({ color: { ...v.color!, primary: e.target.value } })} /></label>
              <label className="dl-field"><span>次色</span><input className="text-input" value={v.color.secondary} onChange={(e) => patch({ color: { ...v.color!, secondary: e.target.value } })} /></label>
              <label className="dl-field"><span>描边色</span><input className="text-input" value={v.color.border} onChange={(e) => patch({ color: { ...v.color!, border: e.target.value } })} /></label>
              <label className="dl-field"><span>阴影色</span><input className="text-input" value={v.color.shadow} onChange={(e) => patch({ color: { ...v.color!, shadow: e.target.value } })} /></label>
              <label className="dl-field"><span>左距</span><input type="number" className="text-input" value={v.margin?.left ?? 10} onChange={(e) => patch({ margin: { left: Number(e.target.value), right: v.margin?.right ?? 10, vertical: v.margin?.vertical ?? 20 } })} /></label>
              <label className="dl-field"><span>右距</span><input type="number" className="text-input" value={v.margin?.right ?? 10} onChange={(e) => patch({ margin: { left: v.margin?.left ?? 10, right: Number(e.target.value), vertical: v.margin?.vertical ?? 20 } })} /></label>
              <label className="dl-field"><span>垂直距</span><input type="number" className="text-input" value={v.margin?.vertical ?? 20} onChange={(e) => patch({ margin: { left: v.margin?.left ?? 10, right: v.margin?.right ?? 10, vertical: Number(e.target.value) } })} /></label>
              <label className="dl-field"><span>对齐</span><select className="text-input" value={v.alignment ?? 2} onChange={(e) => patch({ alignment: Number(e.target.value) })}><option value={1}>左上</option><option value={2}>底部居中</option><option value={9}>右下</option></select></label>
            </div>
          )}
        </div>
        <div className="modal-foot">
          <div className="right">
            <button type="button" className="btn" onClick={onClose}>取消</button>
            <button type="button" className="btn primary" onClick={() => { onChange(v); toast("样式已保存", "ok"); onClose(); }}>保存</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function blank(kind: "danmaku" | "subtitle"): StyleValues {
  if (kind === "danmaku") {
    return { font: { name: "黑体", size: 36, bold: false, italic: false, underline: false, strike: false }, border: { border: 1, shadow: 0 }, advanced: { displayArea: 60, opacity: 80, scrollDuration: 10, staticDuration: 5, minimumGap: 100 }, resolution: { width: 1280, height: 720 } };
  }
  return { font: { name: "黑体", size: 36, bold: false, italic: false, underline: false, strike: false }, border: { border: 1, shadow: 0 }, color: { primary: "&H00FFFFFF", secondary: "&H000000FF", border: "H00000000", shadow: "H00000000" }, margin: { left: 10, right: 10, vertical: 20 }, resolution: { width: 1280, height: 720 }, alignment: 2 };
}