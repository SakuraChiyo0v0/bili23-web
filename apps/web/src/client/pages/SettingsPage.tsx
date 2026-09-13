import { useEffect, useRef, useState } from "react";
import { ThemeSwitcher } from "../components/ThemeSwitcher";
import { NamingRuleEditor, CONVENTION_TYPES } from "../components/NamingRuleEditor";
import { CdnEditor } from "../components/CdnEditor";
import { PriorityDialog } from "../components/PriorityDialog";
import { ProxyDialog } from "../components/ProxyDialog";
import { AreaDialog } from "../components/AreaDialog";
import { UserAgentDialog } from "../components/UserAgentDialog";
import { LogViewerDialog } from "../components/LogViewerDialog";
import { McpCardBody } from "../components/McpCard";
import { SubtitleLanguageDialog, type SubtitleLanguageValue } from "../components/SubtitleLanguageDialog";
import { useToast } from "../lib/toast";
import { DEFAULT_ACCENT, DEFAULT_ACCENT_ALPHA, loadAccentPrefs, setAccent, type AccentPrefs } from "../lib/accent";
import type { PriorityKind } from "../lib/priorityMaps";
import { StyleEditor } from "../components/StyleEditor";
import { useSettingsStore } from "../store/useSettingsStore";
import { exportConfig, importConfig, resetConfig } from "../services/client";
import { DirPicker } from "../components/DirPicker";
import { clearLocalDir, getLocalDirName, pickLocalDir, supportsLocalDir } from "../lib/localDir";
import { GuideDialog } from "../components/GuideDialog";
import { DUPLICATE_DOWNLOAD_GUIDE, NUMBERING_GUIDE, PREALLOCATE_GUIDE, PRIORITY_GUIDE } from "../lib/guides";
import { Icon, type IconName } from "../lib/icons";
import { COLUMN_LABEL, LOCKED_COLUMN, normalizeColumns, useParseListPrefs, type ParseListPrefs } from "../lib/parseListPrefs";
import { useDownloadListPrefs } from "../lib/downloadListPrefs";
import { t as tr } from "../lib/i18n";
import { Overlay } from "../components/Overlay";

export function SettingsPage() {
  const { config, loading, saved, error, load, save } = useSettingsStore();

  useEffect(() => { void load(); /*eslint-disable-next-line*/ }, []);

  if (loading && !config) return <div className="empty-state"><span className="spinner" /><p>{tr("加载设置…")}</p></div>;
  if (error && !config) return <div className="empty-state"><p className="muted">加载失败：{error}</p></div>;
  if (!config) return null;

  const patch = (p: Parameters<typeof save>[0]) => void save(p);

  return (
    <section className="page settings-page">
      <div className="page-head">
        <div className="panel-title">{tr("设置")}</div>
        <div className="spacer" />
        {saved && <span className="muted small">{tr("已保存")}</span>}
        {error && <span className="danger small">{error}</span>}
        <button type="button" className="btn sm" onClick={() => void load()} disabled={loading}>{loading ? tr("加载中…") : tr("重新加载")}</button>
      </div>

      {/* 分组顺序照原版 gui/interface/setting.py:97-129：界面 → 行为 → 下载 → 附加 → 文件命名 → 高级 */}
      <InterfaceGroup config={config} onPatch={patch} />
      <BehaviorGroup config={config} onPatch={patch} />
      <DownloadGroup config={config} onPatch={patch} />
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
      <div className="card-list">{children}</div>
    </div>
  );
}

/**
 * 设置卡片，对齐原版 qfluentwidgets 的 SettingCard：
 * 左侧图标 + 标题/描述，右侧放控件；有 children 的卡片可展开，右侧改成展开箭头。
 * 展开态**默认折叠**（原版只有 PriorityCard / NumberCard 这类才常驻展开）。
 */
function Card({ icon, title, desc, right, children, defaultOpen = false }: {
  icon: IconName;
  title: string;
  desc?: string;
  right?: React.ReactNode;
  children?: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const expandable = Boolean(children);
  const head = (
    <>
      <span className="card-ico"><Icon name={icon} size={20} /></span>
      <div className="card-info">
        <div className="s-title">{title}</div>
        {desc && <div className="s-desc">{desc}</div>}
      </div>
      {expandable
        ? <span className="card-chev"><Icon name="chevD" size={18} /></span>
        : (right ? <div className="control">{right}</div> : null)}
    </>
  );
  // 可展开的卡片整行可点，用 button；不可展开的卡片右侧可能是输入框/按钮，不能嵌进 button 里
  return (
    <div className={`setting-card${expandable && open ? " open" : ""}`}>
      {expandable
        ? <button type="button" className="card-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{head}</button>
        : <div className="card-head">{head}</div>}
      {expandable && open && <div className="card-body">{children}</div>}
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

/**
 * 解析列表的列配置（原版「解析列表设置」弹窗的主体）。
 * 「序号」列锁定：不可取消、不可拖动（原版对第 0 行 setRowEnabled(False) + setMinDragRow(1)）。
 * 触屏拖拽不可靠，所以每一行另外给了 ↑/↓ 按钮。
 */
function ParseListColumns({ prefs, onChange }: {
  prefs: ParseListPrefs;
  onChange: (patch: Partial<ParseListPrefs>) => void;
}) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const move = (from: number, to: number) => {
    if (to < 1 || to >= prefs.columns.length) return;
    const cols = [...prefs.columns];
    const [it] = cols.splice(from, 1);
    cols.splice(to, 0, it!);
    onChange({ columns: normalizeColumns(cols) });
  };
  return (
    <>
      <div className="setting-row">
        <div className="s-info">
          <div className="s-title">{tr("解析列表的列")}</div>
          <div className="s-desc">{tr("选择要显示的列并拖动以调整顺序（「序号」列固定在首位）")}</div>
        </div>
      </div>
      <div className="col-list">
        {prefs.columns.map((c, i) => (
          <div
            key={c.key}
            className={`col-row${c.key === LOCKED_COLUMN ? " locked" : ""}${dragIdx === i ? " dragging" : ""}`}
            draggable={c.key !== LOCKED_COLUMN}
            onDragStart={() => setDragIdx(i)}
            onDragOver={(e) => { if (c.key !== LOCKED_COLUMN) e.preventDefault(); }}
            onDrop={() => { if (dragIdx !== null) move(dragIdx, i); setDragIdx(null); }}
            onDragEnd={() => setDragIdx(null)}
          >
            <label className="col-check">
              <input
                type="checkbox"
                checked={c.show}
                disabled={c.key === LOCKED_COLUMN}
                onChange={(e) => onChange({ columns: prefs.columns.map((x) => (x.key === c.key ? { ...x, show: e.target.checked } : x)) })}
              />
              <span>{tr(COLUMN_LABEL[c.key])}</span>
            </label>
            {c.key !== LOCKED_COLUMN && (
              <span className="col-ops">
                <button type="button" className="icon-btn sm" disabled={i <= 1} onClick={() => move(i, i - 1)} title={tr("上移")} aria-label={tr("上移")}>↑</button>
                <button type="button" className="icon-btn sm" disabled={i >= prefs.columns.length - 1} onClick={() => move(i, i + 1)} title={tr("下移")} aria-label={tr("下移")}>↓</button>
              </span>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function InterfaceGroup({ config, onPatch }: { config: any; onPatch: (p: any) => void }) {
  const [accent, setAccentState] = useState<AccentPrefs>(loadAccentPrefs);
  const b = config.behavior;
  return (
    <Group title={tr("界面")}>
      <Card icon="sun" title={tr("个性化")} desc={tr("自定义应用主题、颜色和视觉效果")}>
        {/* 原版 E21：强调色（系统取色器，**含 alpha**）。这里用原生 color 选择器 + 透明度滑杆 */}
        <Row label={tr("强调色")} desc={`按钮、选中态等的主色；默认 ${DEFAULT_ACCENT}`} control={
          <span className="accent-row">
            <input type="color" className="accent-picker" value={accent.color}
              onChange={(e) => { const next = { ...accent, color: e.target.value }; setAccent(next.color, next.alpha); setAccentState(next); }} />
            <button type="button" className="btn sm ghost" onClick={() => { const next = { color: DEFAULT_ACCENT, alpha: DEFAULT_ACCENT_ALPHA }; setAccent(next.color, next.alpha); setAccentState(next); }}>{tr("恢复默认")}</button>
          </span>
        } />
        {/* 原版取色器里的 alpha 滑杆（QColorDialog 自带）；0–100% */}
        <Row label={tr("强调色透明度")} desc={tr("降低透明度后，主色会与背景混色（原版取色器的 alpha 滑杆）")} control={
          <span className="accent-row">
            <input type="range" min={0} max={100} value={accent.alpha} aria-label={tr("强调色透明度")}
              onChange={(e) => { const next = { ...accent, alpha: Number(e.target.value) }; setAccent(next.color, next.alpha); setAccentState(next); }} />
            <span className="small muted" style={{ width: 40 }}>{accent.alpha}%</span>
          </span>
        } />
        <Row label={tr("主题")} desc={tr("选择应用程序主题")} control={
          <ThemeSwitcher value={b.theme} onChange={(v) => onPatch({ behavior: { theme: v } })} />
        }/>
        {/* 动效偏好（我们自己的设置，原版没有）。改这里就写回配置并镜像到 localStorage，
            下次首屏在 React 渲染前就能用上（见 App.tsx / main.tsx） */}
        <Row label={tr("动效")} desc={tr("界面过渡与动画的强弱；系统开启「减少动态效果」时会自动精简")} control={
          <Seg value={b.motion ?? "smooth"} options={[["smooth", tr("流畅")], ["reduced", tr("精简")]]}
            onChange={(v) => onPatch({ behavior: { motion: v } })} />
        }/>
      </Card>
      {/* 原版是 ComboBoxSettingCard（100%–200%），桌面缩放概念在 Web 端不适用 */}
      <Card icon="eye" title={tr("显示缩放")} desc={tr("调整应用界面的缩放比例")} />
      {/* 语言：原版三选一（简中/繁中/English）。文案已经接上 tr()，切了立即生效
          （App 以语言为 key 重挂整棵树）。字典由 scripts/gen-i18n.mjs 从原版 Qt 翻译文件生成，
          未命中的句子原样显示简中 —— 主要是我们自己加的提示语，原版没有对应译文。 */}
      <Card icon="info" title={tr("语言")} desc={tr("选择应用程序的显示语言")} right={
        <Seg value={b.language} options={[["system", tr("系统默认")],["zh-CN", tr("简体中文")],["zh-TW", tr("繁體中文")],["en","English"]]} onChange={(v) => onPatch({ behavior: { language: v } })} />
      } />
    </Group>
  );
}

function BehaviorGroup({ config, onPatch }: { config: any; onPatch: (p: any) => void }) {
  const b = config.behavior;
  const d = config.download;
  const [listPrefs, setListPrefs] = useParseListPrefs();
  const [dlPrefs, setDlPrefs] = useDownloadListPrefs();
  /** 「预分配文件空间」的说明弹窗（原版是卡片上的超链接，正文 PREALLOCATE_GUIDE） */
  const [preallocGuide, setPreallocGuide] = useState(false);
  /** 「有关重复下载处理的说明」弹窗（原版 `card.py:590-591` 的超链接，正文 DUPLICATE_DOWNLOAD_GUIDE） */
  const [dupGuide, setDupGuide] = useState(false);
  return (
    <Group title={tr("行为")}>
      {/* 对齐原版 ParsingSettingCard：剪贴板监控（Web 不适用）+ 保存解析记录 + 自动选择下载项 + 解析列表设置 */}
      <Card icon="paste" title={tr("解析设置")} desc={tr("配置剪贴板监控、解析历史和解析列表选项")}>
        <Row label={tr("保存解析记录")} desc={tr("保存已解析链接的历史记录")} control={
          <Toggle checked={b.saveParseHistory} onChange={(v) => onPatch({ behavior: { saveParseHistory: v } })} />
        } />
        {/* 原版 ParsingSettingCard「监听剪贴板」。Web 改写：聚焦时读一次，命中只填入不自动解析 */}
        <Row label={tr("监听剪贴板")} desc={tr("页面重新聚焦时读取剪贴板，发现 B 站链接就填入输入框（浏览器无法后台监听，也不会自动解析）")} control={
          <Toggle checked={b.monitorClipboard === true} onChange={(v) => onPatch({ behavior: { monitorClipboard: v } })} />
        } />        {/* 对齐原版「自动选择下载项设置」弹窗（gui/dialog/setting/auto_select.py），文案取自原版简中译文 */}        <Row label={tr("自动选择下载项设置")} desc={tr("配置解析后如何自动选择解析列表中的项目")} control={
          <Seg value={b.autoSelectMode ?? "conditional"} options={[["manual", tr("让我手动选择")], ["all", tr("自动勾选所有项目")], ["conditional", tr("按条件自动勾选")]]} onChange={(v) => onPatch({ behavior: { autoSelectMode: v } })} />
        } />
        {(b.autoSelectMode ?? "conditional") === "conditional" && (
          <>
            <Row label={tr("解析投稿视频时")} desc={tr("仅在选择“按条件自动勾选”时可修改以下规则。")} control={
              <select className="text-input" style={{ width: 260 }} value={b.autoSelectConditions?.userUploads ?? 0}
                onChange={(e) => onPatch({ behavior: { autoSelectConditions: { ...b.autoSelectConditions, userUploads: Number(e.target.value) } } })}>
                <option value={0}>{tr("选中链接所对应的单个视频")}</option>
                <option value={1}>{tr("选中分P或合集中的所有视频")}</option>
              </select>
            } />
            <Row label={tr("解析剧集类或课程类视频时")} desc="" control={
              <select className="text-input" style={{ width: 260 }} value={b.autoSelectConditions?.bangumi ?? 0}
                onChange={(e) => onPatch({ behavior: { autoSelectConditions: { ...b.autoSelectConditions, bangumi: Number(e.target.value) } } })}>
                <option value={0}>{tr("选中链接所对应的单个剧集")}</option>
                <option value={1}>{tr("选中该剧集中所有正片剧集")}</option>
              </select>
            } />
            <Row label={tr("解析其他类型视频时")} desc="" control={
              <select className="text-input" style={{ width: 260 }} value={b.autoSelectConditions?.other ?? 0}
                onChange={(e) => onPatch({ behavior: { autoSelectConditions: { ...b.autoSelectConditions, other: Number(e.target.value) } } })}>
                <option value={0}>{tr("手动选择")}</option>
                <option value={1}>{tr("自动勾选所有项目")}</option>
              </select>
            } />
          </>
        )}
        {/* 对齐原版「解析列表设置」弹窗（gui/dialog/setting/parse_list.py）：列列表 + 两个开关。
            列列表可勾选、可拖动排序；「序号」锁定在第一列（原版 setRowEnabled(0,False) + setMinDragRow(1)）。 */}
        <ParseListColumns prefs={listPrefs} onChange={setListPrefs} />
        <Row label={tr("启用交替行颜色")} desc={tr("相邻行用不同底色区分")} control={
          <Toggle checked={listPrefs.zebraRows} onChange={(v) => setListPrefs({ zebraRows: v })} />
        } />
        {/* 原版「解析列表设置」里的第三个开关。对应行上的「⋯」菜单（桌面 hover 浮现 / 触屏常驻） */}
        <Row label={tr("显示悬浮命令栏")} desc={tr("在解析列表的每一行右侧显示「⋯」菜单")} control={
          <Toggle checked={listPrefs.floatingBar} onChange={(v) => setListPrefs({ floatingBar: v })} />
        } />
      </Card>
      {/* 原版 WindowBehaviorSettingCard：置顶 / 静默启动 / 记住窗口状态 / 关闭主窗口行为 —— 桌面窗口概念，Web 端不适用 */}
      <Card icon="external" title={tr("窗口行为")} desc={tr("调整主窗口在启动、运行和关闭时的行为")} />
      {/* 原版 DownloadHandlingSettingCard：选项对话框 / 通知 / 文件冲突 / 重复下载 / 预分配文件空间 */}
      <Card icon="options" title={tr("下载处理")} desc={tr("配置下载提示、通知以及文件冲突处理方式")}>
        <Row label={tr("下载时显示选项对话框")} desc={tr("在开始下载前弹出对话框，以便自定义本次下载设置")} control={
          <Toggle checked={b.showDownloadOptionsDialog} onChange={(v) => onPatch({ behavior: { showDownloadOptionsDialog: v } })} />
        } />
        <Row label={tr("显示通知")} desc={tr("当下载完成时显示通知")} control={
          <Toggle checked={dlPrefs.notifyFinished} onChange={(v) => {
            if (v && typeof Notification !== "undefined" && Notification.permission === "default") {
              void Notification.requestPermission();
            }
            setDlPrefs({ notifyFinished: v });
          }} />
        } />
        <Row label={tr("同名文件处理")} desc={tr("选择当目标位置已存在同名文件时的操作")} control={
          <Seg value={d.renamePolicy} options={[["auto", tr("自动重命名")],["overwrite", tr("覆盖文件")]]} onChange={(v) => onPatch({ download: { renamePolicy: v } })} />
        } />
        <Row label={tr("重复下载处理")} desc={tr("选择检测到重复下载时的操作")} control={
          <>
            <button type="button" className="btn sm ghost" onClick={() => setDupGuide(true)}>{tr("说明")}</button>
            <Seg value={d.duplicatePolicy} options={[["force", tr("继续下载")],["skip", tr("跳过下载")],["prompt", tr("总是询问")]]} onChange={(v) => onPatch({ download: { duplicatePolicy: v } })} />
          </>
        } />
        {/* 原版 DownloadHandlingSettingCard：「预分配文件空间」+ 说明超链接（`card.py:578,582,587`） */}
        <Row label={tr("预分配文件空间")} desc={tr("下载前预分配文件空间以提升性能")} control={
          <>
            <button type="button" className="btn sm ghost" onClick={() => setPreallocGuide(true)}>{tr("说明")}</button>
            <Toggle checked={b.preallocateFileSpace !== false} onChange={(v) => onPatch({ behavior: { preallocateFileSpace: v } })} />
          </>
        } />
      </Card>
      {/* 原版「有关预分配文件空间的说明」超链接（正文 = PREALLOCATE_GUIDE 的简中译文） */}
      <GuideDialog open={preallocGuide} title={tr("有关预分配文件空间的说明")} text={PREALLOCATE_GUIDE} onClose={() => setPreallocGuide(false)} />
      {/* 原版「有关重复下载处理的说明」超链接（`card.py:590-591`） */}
      <GuideDialog open={dupGuide} title={tr("有关重复下载处理的说明")} text={DUPLICATE_DOWNLOAD_GUIDE} onClose={() => setDupGuide(false)} />
    </Group>
  );
}

function DownloadGroup({ config, onPatch }: { config: any; onPatch: (p: any) => void }) {
  const d = config.download;
  const [pickerOpen, setPickerOpen] = useState(false);
  /** 当前打开的自定义优先级弹窗（原版 PriorityDialog；kind + 打开时的快照 + 写回函数） */
  const [prioOpen, setPrioOpen] = useState<{ kind: PriorityKind; value: number[]; write: (v: number[]) => void } | null>(null);
  /** 「有关优先级的说明」（原版 PrioritySettingCard 的超链接，`card.py:235`） */
  const [prioGuide, setPrioGuide] = useState(false);
  const { toast } = useToast();
  /** 产物默认落点（NAS / 本机）—— 存的配置键是 `download.deliver` */
  const deliverMode: "server" | "local" = d.deliver === "local" ? "local" : "server";
  /** 已授权的本机文件夹名（浏览器不给绝对路径，只能拿到名字） */
  const [localDir, setLocalDir] = useState<string | null>(null);
  useEffect(() => { void getLocalDirName().then(setLocalDir); }, []);
  const chooseLocalDir = async () => {
    const name = await pickLocalDir();
    if (name) { setLocalDir(name); toast(tr("已授权本机文件夹"), "ok"); }
    else if (!supportsLocalDir()) toast(tr("这个浏览器不支持选择本机文件夹（手机浏览器都不支持）"), "warn");
  };
  const clearLocalDirAndRefresh = async () => { await clearLocalDir(); setLocalDir(null); toast(tr("已清除本机文件夹授权"), "info"); };
  /** 本机模式的说明：按浏览器支持情况给不同文案 */
  const localDirNote = !supportsLocalDir()
    ? tr("当前浏览器不支持选择本机文件夹（手机浏览器都不支持）：产物会进浏览器默认的下载文件夹")
    : localDir
      ? tr("「保存到本机」的产物会直接写进这个文件夹；浏览器不暴露完整路径，只显示文件夹名")
      : tr("还没选：点右边的按钮授权一个本机文件夹（只显示文件夹名，浏览器不给完整路径）");
  return (
    <Group title={tr("下载")}>
      {/* 「下载路径」卡：先选**模式**（NAS / 本机），再显示对应那一侧的目录 */}
      <Card icon="folder" title={tr("下载路径")} desc={
        deliverMode === "local"
          ? tr("本机模式：产物先落服务器的临时投递目录，取回本机后即删（服务器不留副本）")
          : tr("NAS 模式：产物存到服务器（NAS）的下载目录，可在「产物」页浏览/下载")
      }>
        <Row label={tr("保存到")} desc={tr("选择产物默认存到 NAS 还是本机")} control={
          <div className="seg">
            <button type="button" className={`seg-btn${deliverMode === "server" ? " active" : ""}`}
              onClick={() => onPatch({ download: { deliver: "server" } })}>{tr("NAS（服务器）")}</button>
            <button type="button" className={`seg-btn${deliverMode === "local" ? " active" : ""}`}
              onClick={() => onPatch({ download: { deliver: "local" } })}>{tr("本机")}</button>
          </div>
        } />
        {deliverMode === "server" ? (
          <Row label={tr("服务器上的目录")} desc={tr("这是服务器（NAS）上的目录，不是你电脑的")} control={
            <span className="dir-picker-row">
              <input className="text-input" style={{ width: 260 }} value={d.dir} placeholder={tr("默认下载目录")} onChange={(e) => onPatch({ download: { dir: e.target.value } })} />
              <button type="button" className="btn sm" onClick={() => setPickerOpen(true)}>{tr("浏览…")}</button>
            </span>
          } />
        ) : (
          <Row label={tr("本机文件夹")} desc={
            localDirNote
          } control={
            <span className="dir-picker-row">
              <span className="text-input" style={{ width: 200, display: "inline-flex", alignItems: "center", color: localDir ? undefined : "var(--muted)" }}>
                {localDir ?? tr("未选择")}
              </span>
              <button type="button" className="btn sm" onClick={() => void chooseLocalDir()} disabled={!supportsLocalDir()}>{tr("选择本机文件夹")}</button>
              {localDir && <button type="button" className="btn sm ghost" onClick={() => void clearLocalDirAndRefresh()}>{tr("清除")}</button>}
            </span>
          } />
        )}
      </Card>
      <DirPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        value={d.dir}
        onPick={(dir) => onPatch({ download: { dir } })}
      />
      <Card icon="batch" title={tr("下载并发")} desc={tr("调整每任务线程数、并发下载数和速度限制")}>
        <Row label={tr("多线程数")} desc={tr("调整单个任务使用的线程数，默认为 4")} control={
          <Slider value={d.threads} min={1} max={16} onChange={(v) => onPatch({ download: { threads: Number(v) } })} suffix="线程" />
        }/>
        <Row label={tr("并行下载数")} desc={tr("调整同时下载的任务数，默认为 1")} control={
          <Slider value={d.parallel} min={1} max={16} onChange={(v) => onPatch({ download: { parallel: Number(v) } })} suffix="任务" />
        }/>
        <Row label={tr("速度限制设置")} desc={tr("配置下载的速度限制设置")} control={
          <>
            <input type="number" className="text-input" style={{ width: 120 }} value={d.speedLimitKbps} min={0} onChange={(e) => onPatch({ download: { speedLimitKbps: Number(e.target.value) } })} />
            <span className="small muted">KB/s</span>
          </>
        }/>
      </Card>
      {/* 原版 PrioritySettingCard：三行「自定义…」，各自打开自定义优先级弹窗 */}
      <Card icon="star" title={tr("画质、音质和编码优先级")} desc={tr("自定义下载的优先级")}>
        <Row label={tr("说明")} desc={tr("查看优先级的生效方式")} control={
          <button type="button" className="btn sm ghost" onClick={() => setPrioGuide(true)}>{tr("有关优先级的说明")}</button>
        } />
        <Row label={tr("画质优先级")} desc={tr("越靠上越优先")} control={
          <button type="button" className="btn sm" onClick={() => setPrioOpen({ kind: "video", value: d.videoQualityPriority, write: (v) => onPatch({ download: { videoQualityPriority: v } }) })}>{tr("自定义…")}</button>
        } />
        <Row label={tr("音质优先级")} desc={tr("越靠上越优先")} control={
          <button type="button" className="btn sm" onClick={() => setPrioOpen({ kind: "audio", value: d.audioQualityPriority, write: (v) => onPatch({ download: { audioQualityPriority: v } }) })}>{tr("自定义…")}</button>
        } />
        <Row label={tr("编码优先级")} desc={tr("越靠上越优先")} control={
          <button type="button" className="btn sm" onClick={() => setPrioOpen({ kind: "codec", value: d.videoCodecPriority, write: (v) => onPatch({ download: { videoCodecPriority: v } }) })}>{tr("自定义…")}</button>
        } />
      </Card>
      <Card icon="download" title={tr("下载格式")} desc={tr("设置下载文件的输出格式选项")}>
        <Row label={tr("输出容器格式")} desc="" control={
          <Seg value={d.defaultContainer} options={[["mp4","MP4"],["mkv","MKV"]]} onChange={(v) => onPatch({ download: { defaultContainer: v } })} />
        }/>
        {/* 原版 DownloadFormatCard 里的「将 M4A 转换为 MP3」（`card.py:538`） */}
        <Row label={tr("将 M4A 转换为 MP3")} desc={tr("仅在下载纯音频流时有效")} control={
          <Toggle checked={d.m4aToMp3 === true} onChange={(v) => onPatch({ download: { m4aToMp3: v } })} />
        }/>
      </Card>
      <PriorityDialog
        kind={prioOpen?.kind ?? null}
        value={prioOpen?.value ?? []}
        onClose={() => setPrioOpen(null)}
        onConfirm={(next) => { prioOpen?.write(next); setPrioOpen(null); }}
      />
      {/* 原版 PrioritySettingCard 的「有关优先级的说明」超链接（`card.py:235`） */}
      <GuideDialog open={prioGuide} title={tr("有关优先级的说明")} text={PRIORITY_GUIDE} onClose={() => setPrioGuide(false)} />
    </Group>
  );
}

function AdditionalGroup({ config, onPatch }: { config: any; onPatch: (p: any) => void }) {
  const a = config.additional || {};
  const [styleKind, setStyleKind] = useState<"" | "danmaku" | "subtitle">("");
  const [langOpen, setLangOpen] = useState(false);
  /** 字幕语言的全局默认（字段本来就在 additional.subtitle.language 里生效，之前只是没有设置入口） */
  const langSelection: SubtitleLanguageValue = a.subtitle?.language ?? { downloadSpecified: false, specifiedLanguages: [] };
  const patch = (extra: string, patchObj: any) => onPatch({ additional: { [extra]: patchObj } });
  const patchD = (patchObj: any) => patch("danmaku", { ...a.danmaku, ...patchObj });
  const patchS = (patchObj: any) => patch("subtitle", { ...a.subtitle, ...patchObj });
  const patchC = (patchObj: any) => patch("cover", { ...a.cover, ...patchObj });
  const patchM = (patchObj: any) => patch("metadata", { ...a.metadata, ...patchObj });
  return (
    <Group title={tr("弹幕、字幕、封面、章节和元数据")}>
      <Card icon="play" title={tr("弹幕下载设置")} desc={tr("调整弹幕下载设置")}>
        <Row label={tr("下载弹幕")} desc="" control={<Toggle checked={a.danmaku?.enabled} onChange={(v) => patchD({ enabled: v })} />} />
        {a.danmaku?.enabled && (
          <>
            <Row label={tr("弹幕格式")} desc={tr("输出格式")} control={
              <select className="text-input" style={{ width: 140 }} value={a.danmaku?.format ?? "ass"} onChange={(e) => patchD({ format: e.target.value })}>
                <option value="xml">XML</option><option value="ass">ASS</option><option value="json">JSON</option>
              </select>
            } />
            <Row label={tr("弹幕样式")} desc={tr("仅 ASS 格式弹幕有效")} control={<button type="button" className="btn sm ghost" onClick={() => setStyleKind("danmaku")}>{tr("自定义…")}</button>} />
            <Row label={tr("嵌入弹幕")} desc={tr("将弹幕作为字幕轨嵌入到视频文件中，仅在弹幕格式为 ASS 且输出容器为 MKV 时可用")} control={<Toggle checked={a.danmaku?.embed} onChange={(v) => patchD({ embed: v })} />} />
            {a.danmaku?.embed && (
              <Row label={tr("嵌入后删除弹幕文件")} desc={tr("将弹幕嵌入视频文件后删除原弹幕文件")} control={<Toggle checked={a.danmaku?.deleteAfterEmbed} onChange={(v) => patchD({ deleteAfterEmbed: v })} />} />
            )}
          </>
        )}
      </Card>
      <Card icon="info" title={tr("字幕下载设置")} desc={tr("调整字幕下载设置")}>
        <Row label={tr("下载字幕")} desc="" control={<Toggle checked={a.subtitle?.enabled} onChange={(v) => patchS({ enabled: v })} />} />
        {a.subtitle?.enabled && (
          <>
            <Row label={tr("字幕格式")} desc={tr("输出格式")} control={
              <select className="text-input" style={{ width: 140 }} value={a.subtitle?.format ?? "ass"} onChange={(e) => patchS({ format: e.target.value })}>
                <option value="srt">SRT</option><option value="lrc">LRC</option><option value="txt">TXT</option>
                <option value="ass">ASS</option><option value="json">JSON</option>
              </select>
            } />
            <Row label={tr("字幕样式")} desc={tr("仅 ASS 格式字幕有效")} control={<button type="button" className="btn sm ghost" onClick={() => setStyleKind("subtitle")}>{tr("自定义…")}</button>} />
            {/* 原版 SubtitlesLanguageDialog 的全局默认入口：字段本来就生效，之前只是设置页没有入口 */}
            <Row label={tr("字幕语言")} desc={langSelection.downloadSpecified ? `只下载：${langSelection.specifiedLanguages.join("、") || "（未选择）"}` : "下载全部语言"} control={
              <button type="button" className="btn sm" onClick={() => setLangOpen(true)}>{tr("自定义…")}</button>
            } />
            <Row label={tr("嵌入字幕")} desc={tr("将字幕作为字幕轨嵌入到视频文件中，仅在字幕格式为 ASS 且输出容器为 MKV 时可用")} control={<Toggle checked={a.subtitle?.embed} onChange={(v) => patchS({ embed: v })} />} />
            {a.subtitle?.embed && (
              <Row label={tr("嵌入后删除字幕文件")} desc={tr("将字幕嵌入视频文件后删除原字幕文件")} control={<Toggle checked={a.subtitle?.deleteAfterEmbed} onChange={(v) => patchS({ deleteAfterEmbed: v })} />} />
            )}
          </>
        )}
      </Card>
      <SubtitleLanguageDialog open={langOpen} onClose={() => setLangOpen(false)}
        selection={langSelection}
        onChange={(v) => patchS({ language: v })} />
      <Card icon="eye" title={tr("封面下载设置")} desc={tr("调整封面下载设置")}>
        <Row label={tr("下载封面")} desc="" control={<Toggle checked={a.cover?.enabled} onChange={(v) => patchC({ enabled: v })} />} />
        {a.cover?.enabled && (
          <>
            <Row label={tr("封面格式")} desc="" control={
              <select className="text-input" style={{ width: 140 }} value={a.cover?.format ?? "jpg"} onChange={(e) => { const format = e.target.value; patchC({ format, attach: format === "avif" ? false : a.cover?.attach }); }}>
                <option value="jpg">JPG</option><option value="png">PNG</option>
                <option value="avif">AVIF</option><option value="webp">WEBP</option>
              </select>
            } />
            <Row label={tr("嵌入封面")} desc={tr("AVIF 不支持嵌入")} control={<Toggle checked={a.cover?.attach} onChange={(v) => patchC({ attach: v })} />} />
            {a.cover?.attach && (
              <Row label={tr("嵌入后删除封面")} desc={tr("将封面嵌入视频文件后删除原封面文件")} control={<Toggle checked={a.cover?.deleteAfterAttach} onChange={(v) => patchC({ deleteAfterAttach: v })} />} />
            )}
          </>
        )}
      </Card>
      <Card icon="batch" title={tr("章节设置")} desc={tr("调整章节相关设置")}>
        <Row label={tr("嵌入章节信息")} desc={tr("将视频的分段章节写入视频文件，仅在合并视频和音频时生效")} control={<Toggle checked={a.chapter?.embed} onChange={(v) => patch("chapter", { ...a.chapter, embed: v })} />} />
      </Card>
      <Card icon="search" title={tr("元数据下载设置")} desc={tr("调整元数据下载设置")}>
        <Row label={tr("下载元数据")} desc="" control={<Toggle checked={a.metadata?.enabled} onChange={(v) => patchM({ enabled: v })} />} />
        {a.metadata?.enabled && (
          <Row label={tr("元数据格式")} desc="" control={
            <select className="text-input" style={{ width: 140 }} value={a.metadata?.format ?? "nfo"} onChange={(e) => patchM({ format: e.target.value })}>
              <option value="nfo">NFO</option><option value="json">JSON</option>
            </select>
          } />
        )}
      </Card>
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
  /** 「有关编号设置的说明」弹窗（原版 NumberSettingCard 的超链接，`card.py:435-442`） */
  const [numberingGuide, setNumberingGuide] = useState(false);
  const saveRules = (next: any[]) => {
    onPatch({ fileNaming: { rules: next } });
  };
  return (
    <Group title={tr("文件命名")}>
      <Card icon="options" title={tr("命名规则")} desc={tr("自定义下载文件的命名规则")} right={
        <button type="button" className="btn sm" onClick={() => setEditorOpen(true)}>{tr("编辑")}</button>
      } />
      {/* 当前规则一览：卡片结构里没有它的位置，单独用一块面板承载（内容与原实现一致） */}
      <div className="panel naming-panel">
        <div className="naming-list">
          {rules.map((r: any) => (
            <div key={r.id} className="naming-row">
              <span className="naming-name">{r.name}</span>
              <span className="naming-type">{tr(CONVENTION_LABELS[r.type] ?? `分类 ${r.type}`)}</span>
              <code className="naming-rule">{r.rule}</code>
            </div>
          ))}
        </div>
      </div>
      <NamingRuleEditor open={editorOpen} onClose={() => setEditorOpen(false)} rules={rules} onChange={saveRules} />
      <Card icon="history" title={tr("编号设置")} desc={tr("配置 {number} 变量的格式")}>
        <Row label={tr("编号模式")} desc={tr("选择 {number} 变量的格式化方式和递增方式")} control={
          <Seg value={String(numbering)} options={[["0", tr("批次从 1")],["1", tr("用解析列表序号")],["2", tr("全局连续")]]} onChange={(v) => onPatch({ fileNaming: { numberingType: Number(v) } })} />
        }/>
        <Row label={tr("全局起始编号")} desc={tr("设置全局顺序的起始编号")} control={
          <input type="number" className="text-input" style={{ width: 120 }} value={f.startingNumber} min={1} onChange={(e) => onPatch({ fileNaming: { startingNumber: Number(e.target.value) } })} />
        }/>
        <Row label={tr("说明")} desc={tr("查看各「编号模式」的含义")} control={
          <button type="button" className="btn sm ghost" onClick={() => setNumberingGuide(true)}>{tr("有关编号设置的说明")}</button>
        }/>
      </Card>
      <GuideDialog open={numberingGuide} title={tr("有关编号设置的说明")} text={NUMBERING_GUIDE} onClose={() => setNumberingGuide(false)} />
    </Group>
  );
}

function AdvancedGroup({ config, onPatch }: { config: any; onPatch: (p: any) => void }) {
  const ad = config.advanced || {};
  const { toast } = useToast();
  const [cdnOpen, setCdnOpen] = useState(false);
  const [areaOpen, setAreaOpen] = useState(false);
  const [proxyOpen, setProxyOpen] = useState(false);
  const [uaOpen, setUaOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  /** 配置文件设置：隐藏的文件选择框 + 重置确认 */
  const fileRef = useRef<HTMLInputElement>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const doExport = async () => {
    try {
      const config = await exportConfig();
      const url = URL.createObjectURL(new Blob([JSON.stringify(config, null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url; a.download = "bili23-web-config.json"; a.click();
      URL.revokeObjectURL(url);
      toast(tr("配置已导出"), "ok");
    } catch (e) { toast("导出失败：" + (e instanceof Error ? e.message : String(e)), "err"); }
  };
  const doImport = async (file: File) => {
    try {
      const applied = await importConfig(JSON.parse(await file.text()));
      useSettingsStore.setState({ config: applied.config });
      toast(tr("配置已导入"), "ok");
    } catch (e) { toast("导入失败：" + (e instanceof Error ? e.message : String(e)), "err"); }
  };
  const doReset = async () => {
    try {
      const applied = await resetConfig();
      useSettingsStore.setState({ config: applied.config });
      setResetOpen(false);
      toast(tr("已重置为默认配置"), "ok");
    } catch (e) { toast("重置失败：" + (e instanceof Error ? e.message : String(e)), "err"); }
  };
  // 大陆 / 海外两套节点各自保存（advanced.cnCdnHosts / ovCdnHosts）
  const saveCdnHosts = (cnHosts: any[], ovHosts: any[]) => {
    onPatch({ advanced: { cnCdnHosts: cnHosts, ovCdnHosts: ovHosts } });
  };
  const proxyForm = {
    proxyType: (ad.proxyType ?? "http") as "http",
    proxyServer: ad.proxyServer ?? "",
    proxyPort: ad.proxyPort ?? 80,
    proxyUname: ad.proxyUname ?? "",
    proxyPassword: ad.proxyPassword ?? "",
  };
  return (
    <Group title={tr("高级")}>
      {/* 原版 CDNSettingCard：优先使用服务商 CDN 开关 + 选择地理位置 + 节点列表 */}
      <Card icon="external" title={tr("CDN 设置")} desc={tr("调整用于下载的 CDN 设置")}>
        <Row label={tr("优先使用服务商 CDN")} desc={tr("优先使用服务器商提供的 CDN，提高下载稳定性")} control={
          <Toggle checked={ad.preferCdnServerProvider !== false} onChange={(v) => onPatch({ advanced: { preferCdnServerProvider: v } })} />
        }/>
        <Row label={tr("选择地理位置")} desc={tr("选择你的实际所在地，以自动匹配更合适的 CDN 服务器")} control={
          <>
            <span className="small muted">{ad.area === "ov" ? tr("中国大陆以外地区") : tr("中国大陆")}</span>
            <button type="button" className="btn sm" onClick={() => setAreaOpen(true)}>{tr("配置…")}</button>
          </>
        }/>
        <Row label={tr("CDN 节点")} desc={tr("自定义服务商节点（大陆 / 海外两套）")} control={
          <button type="button" className="btn sm" onClick={() => setCdnOpen(true)}>{tr("编辑")}</button>
        }/>
      </Card>
      <CdnEditor open={cdnOpen} onClose={() => setCdnOpen(false)} hosts={ad.cnCdnHosts ?? []} ovHosts={ad.ovCdnHosts ?? []} onChange={saveCdnHosts} />
      <AreaDialog open={areaOpen} value={(ad.area ?? "cn") as "cn" | "ov"} onClose={() => setAreaOpen(false)}
        onConfirm={(v) => { onPatch({ advanced: { area: v } }); setAreaOpen(false); }} />
      <Card icon="gear" title={tr("FFmpeg 设置")} desc={tr("配置用于合并和转换视频的 FFmpeg")} right={
        <input className="text-input" style={{ width: 260 }} value={ad.ffmpegPath ?? ""} placeholder={tr("系统 PATH")} onChange={(e) => onPatch({ advanced: { ffmpegPath: e.target.value || undefined } })} />
      } />
      {/* 原版 ProxySettingCard：代理模式三态 + 「设置代理服务器」。
          三个模式名逐字取原版 `ProxySettingCard`：不使用代理 / 使用系统代理 / 手动设置 */}
      <Card icon="external" title={tr("代理设置")} desc={tr("调整用于解析和下载的代理服务器设置")} right={
        <>
          <Seg value={ad.proxyMode ?? "system"}
            options={[["disabled", tr("不使用代理")], ["system", tr("使用系统代理")], ["manual", tr("手动设置")]]}
            onChange={(v) => onPatch({ advanced: { proxyMode: v } })} />
          <button type="button" className="btn sm" onClick={() => setProxyOpen(true)}>{tr("设置代理服务器")}</button>
        </>
      } />
      <ProxyDialog open={proxyOpen} value={proxyForm} onClose={() => setProxyOpen(false)}
        onConfirm={(next) => { onPatch({ advanced: { ...next } }); setProxyOpen(false); }} />
      {/* 原版 MCPSettingCard：启用开关 / 访问令牌 / 客户端配置 / 帮助文档 / 启动失败状态 */}
      <Card icon="gear" title={tr("MCP 服务器")} desc={tr("让 AI 客户端通过 Model Context Protocol 解析链接并管理下载任务")}>
        <McpCardBody cfg={ad} onPatch={onPatch} toast={toast} />
      </Card>
      <Card icon="options" title={tr("其他高级设置")} desc={tr("配置其他高级设置")}>
        {/* 原版「自定义 User-Agent」在 OtherSettingCard 里 */}
        <Row label={tr("自定义 User-Agent")} desc={tr("设置网络请求使用的 User-Agent 字符串")} control={
          <button type="button" className="btn sm" onClick={() => setUaOpen(true)}>{tr("自定义…")}</button>
        }/>
        <UserAgentDialog open={uaOpen} value={ad.userAgent ?? ""} onClose={() => setUaOpen(false)}
          onConfirm={(v) => { onPatch({ advanced: { userAgent: v } }); setUaOpen(false); }} />
        <Row label={tr("默认画质档位")} desc={tr("缺省时不覆盖自动选择")} control={
          <input type="number" className="text-input" style={{ width: 120 }} value={ad.defaultVideoQualityId ?? ""} placeholder="Auto" onChange={(e) => onPatch({ advanced: { defaultVideoQualityId: e.target.value ? Number(e.target.value) : undefined } })} />
        }/>
        <Row label={tr("默认音质档位")} desc="" control={
          <input type="number" className="text-input" style={{ width: 120 }} value={ad.defaultAudioQualityId ?? ""} placeholder="Auto" onChange={(e) => onPatch({ advanced: { defaultAudioQualityId: e.target.value ? Number(e.target.value) : undefined } })} />
        }/>
        <Row label={tr("默认编码档位")} desc="" control={
          <input type="number" className="text-input" style={{ width: 120 }} value={ad.defaultCodecId ?? ""} placeholder="Auto" onChange={(e) => onPatch({ advanced: { defaultCodecId: e.target.value ? Number(e.target.value) : undefined } })} />
        }/>
      </Card>
      {/* 原版日志卡是「查看日志」按钮，Web 端没有日志查看器 */}
      {/* 原版「配置文件设置」卡：导入 / 导出 / 重置（「打开配置目录」浏览器无等价物，不做）。
          desc 取原版 `OtherAdvancedSettingCard` 的译文「导入/导出配置文件或重置为默认值」 */}
      <Card icon="folder" title={tr("配置文件设置")} desc={tr("导入/导出配置文件或重置为默认值")}>
        <Row label={tr("导出配置")} desc={tr("把当前配置导出为 JSON 文件（可用于备份或迁移到别的部署）")} control={
          <button type="button" className="btn sm" onClick={() => void doExport()}>{tr("导出")}</button>
        } />
        <Row label={tr("导入配置")} desc={tr("从 JSON 文件恢复配置；非法值会被净化，校验不通过则不会写入")} control={
          <button type="button" className="btn sm" onClick={() => fileRef.current?.click()}>{tr("选择文件…")}</button>
        } />
        <Row label={tr("重置配置")} desc={tr("恢复为默认配置（不可撤销）")} control={
          <button type="button" className="btn sm ghost" onClick={() => setResetOpen(true)}>{tr("重置")}</button>
        } />
      </Card>
      {/* 原版「日志」卡：View Logs=查看日志，打开 LogViewerDialog */}
      <Card icon="history" title={tr("日志")} desc={tr("查看应用程序日志")} right={
        <button type="button" className="btn sm" onClick={() => setLogOpen(true)}>{tr("查看日志")}</button>
      } />
      <LogViewerDialog open={logOpen} onClose={() => setLogOpen(false)} />
      <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void doImport(f); e.target.value = ""; }} />
      <Overlay open={resetOpen} onClose={() => setResetOpen(false)} dismissable={false} size="sm">
            <div className="modal-head">
              <div className="modal-title">{tr("重置配置")}</div>
              <button type="button" className="icon-btn" onClick={() => setResetOpen(false)} aria-label={tr("关闭")}>
                <svg className="ico" viewBox="0 0 24 24" width={18} height={18}><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
            <div className="modal-body"><p className="small">{tr("所有设置将恢复为默认值，且不可撤销。是否继续？")}</p></div>
            <div className="modal-foot">
              <div className="right">
                <button type="button" className="btn" onClick={() => setResetOpen(false)}>{tr("取消")}</button>
                <button type="button" className="btn primary" onClick={() => void doReset()}>{tr("继续")}</button>
              </div>
            </div>
          </Overlay>
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
