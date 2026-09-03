import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type {
  CoverFormatDTO,
  DanmakuFormatDTO,
  DownloadOptionsDTO,
  ExtrasOptionsDTO,
  MediaItemDTO,
  MediaOptionSummaryDTO,
  MetadataFormatDTO,
  ParseResultDTO,
  SubtitleFormatDTO,
  AuthStatusDTO,
} from "./types.js";
import { formatDuration } from "./types.js";
import { useI18n, type I18nKey } from "./i18n.js";
import { CheckIcon, SearchIcon, DownloadIcon, LogoIcon } from "./icons.js";

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok || (json as { error?: unknown }).error) {
    throw new Error(json.error?.message ?? `HTTP ${res.status}`);
  }
  return json;
}

interface Props {
  onCreated: () => void;
  onGoDownload: () => void;
  onGoSettings: () => void;
}

const BATCH_BUSY = "__batch__";

/** 解析类型入口：对应桌面 ParserType 各类型 */
type ParseMode =
  | "video"
  | "bangumi"
  | "cheese"
  | "lesson"
  | "audio"
  | "favlist"
  | "space"
  | "popular"
  | "watch_later"
  | "history";

/** 类别：链接型 / 空间型 / 周刊型 / 登录型 */
type ModeKind = "link" | "space" | "popular" | "auth";

/** 类型入口配置（label 用 i18n key） */
const PARSE_TYPES: Array<{ id: ParseMode; labelKey: I18nKey; kind: ModeKind }> = [
  { id: "video", labelKey: "parse.type.video", kind: "link" },
  { id: "bangumi", labelKey: "parse.type.bangumi", kind: "link" },
  { id: "cheese", labelKey: "parse.type.cheese", kind: "link" },
  { id: "audio", labelKey: "parse.type.audio", kind: "link" },
  { id: "favlist", labelKey: "parse.type.favlist", kind: "link" },
  { id: "space", labelKey: "parse.type.space", kind: "space" },
  { id: "popular", labelKey: "parse.type.popular", kind: "popular" },
  { id: "watch_later", labelKey: "parse.type.watch_later", kind: "auth" },
  { id: "history", labelKey: "parse.type.history", kind: "auth" },
];

function kindOf(mode: ParseMode): ModeKind {
  return PARSE_TYPES.find((p) => p.id === mode)?.kind ?? "link";
}

/** 依据类型入口构造 /api/parse 的请求体 */
function buildParseBody(
  mode: ParseMode,
  urlText: string,
  spaceInput: string,
  typeKeyword: string,
  weekText: string,
): Record<string, unknown> {
  const kind = kindOf(mode);
  if (kind === "link") {
    const urls = urlText
      .split(/\r?\n|,|;/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return { urls };
  }
  if (kind === "space") {
    return { type: mode, query: spaceInput.trim(), keyword: typeKeyword.trim() };
  }
  if (kind === "popular") {
    const num = Math.floor(Number(weekText));
    return { type: mode, weekNum: Number.isFinite(num) && num > 0 ? num : 1 };
  }
  // auth（watch_later / history）
  return { type: mode, keyword: typeKeyword.trim() };
}

/** 当前模式下是否可以发起解析 */
function canParse(mode: ParseMode, urlText: string, spaceInput: string): boolean {
  const kind = kindOf(mode);
  if (kind === "link") return urlText.trim().length > 0;
  if (kind === "space") return spaceInput.trim().length > 0;
  // popular / auth 无需额外输入即可解析
  return true;
}


export function ParseView({ onCreated, onGoDownload, onGoSettings }: Props) {
  const { t } = useI18n();
  const [urlText, setUrlText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<ParseResultDTO[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [options, setOptions] = useState<Record<string, MediaOptionSummaryDTO>>({});
  const [rowSel, setRowSel] = useState<Record<string, DownloadOptionsDTO>>({});
  const [busy, setBusy] = useState<string | null>(null);
  // ---------- 类型入口 ----------
  const [mode, setMode] = useState<ParseMode>("video");
  const [spaceInput, setSpaceInput] = useState("");
  const [typeKeyword, setTypeKeyword] = useState("");
  const [weekText, setWeekText] = useState("1");
  const [auth, setAuth] = useState<AuthStatusDTO>({ loggedIn: false, preview: "" });

  const kind = kindOf(mode);
  const needsLogin = kind === "auth";

  useEffect(() => {
    fetch("/api/auth/status")
      .then((r) => r.json() as Promise<AuthStatusDTO>)
      .then((s) => setAuth(s))
      .catch(() => setAuth({ loggedIn: false, preview: "" }));
  }, []);

  const items = useMemo(() => {
    const list: MediaItemDTO[] = [];
    for (const r of results) for (const it of r.items) list.push(it);
    return list;
  }, [results]);

  const selectedItems = useMemo(() => items.filter((i) => checked.has(i.id)), [items, checked]);

  /** 关键词筛选：按 title / groupTitle / owner.name 包含匹配 */
  const visibleItems = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return items;
    return items.filter(
      (it) =>
        it.title.toLowerCase().includes(kw) ||
        it.groupTitle.toLowerCase().includes(kw) ||
        it.owner.name.toLowerCase().includes(kw),
    );
  }, [items, keyword]);

  /** 批量下载范围 = 当前筛选结果中仍勾选的条目 */
  const visibleSelected = useMemo(
    () => visibleItems.filter((i) => checked.has(i.id)),
    [visibleItems, checked],
  );

  const parse = useCallback(async () => {
    setError("");
    setParsing(true);
    try {
      const body = buildParseBody(mode, urlText, spaceInput, typeKeyword, weekText);
      const { results: parsed } = await postJson<{ results: ParseResultDTO[] }>("/api/parse", body);
      setResults((prev) => [...prev, ...parsed]);
      const all = new Set<string>();
      for (const r of parsed) for (const it of r.items) all.add(it.id);
      setChecked((prev) => {
        const next = new Set(prev);
        for (const id of all) next.add(id);
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setParsing(false);
    }
  }, [mode, urlText, spaceInput, typeKeyword, weekText]);

  const loadOptions = useCallback(
    async (item: MediaItemDTO) => {
      setExpanded(item.id);
      if (options[item.id]) return;
      try {
        const summary = await fetch(`/api/media/${encodeURIComponent(item.id)}`).then((r) => r.json());
        if (summary && !summary.error) {
          setOptions((prev) => ({ ...prev, [item.id]: summary as MediaOptionSummaryDTO }));
        }
      } catch {
        // 选项加载失败仅静默
      }
    },
    [options],
  );

  const startDownload = useCallback(
    async (itemIds: string[], opts: DownloadOptionsDTO) => {
      setBusy(itemIds.join(","));
      setError("");
      try {
        await postJson<{ tasks: unknown[]; duplicates: unknown[] }>("/api/download", {
          itemIds,
          options: opts,
        });
        onCreated();
        onGoDownload();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [onCreated, onGoDownload],
  );

  /** 批量下载：逐条使用该行的独立选项创建；行无独立选项则传默认（不带 extras） */
  const startBatch = useCallback(async () => {
    if (visibleSelected.length === 0 || busy !== null) return;
    setBusy(BATCH_BUSY);
    setError("");
    let created = 0;
    let duplicates = 0;
    try {
      for (const item of visibleSelected) {
        const res = await fetch("/api/download", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            itemIds: [item.id],
            options: rowSel[item.id] ?? {},
          }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          error?: { code?: string; message?: string };
        };
        if (!res.ok) {
          if (json.error?.code === "DUPLICATE") {
            duplicates += 1;
            continue;
          }
          throw new Error(json.error?.message ?? `HTTP ${res.status}`);
        }
        created += 1;
      }
      if (created > 0) {
        onCreated();
        onGoDownload();
      } else if (duplicates > 0) {
        setError(t("parse.dupSkipped"));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [visibleSelected, rowSel, busy, onCreated, onGoDownload, t]);

  const toggle = useCallback((id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const setAllVisible = useCallback(
    (on: boolean) => {
      setChecked((prev) => {
        const next = new Set(prev);
        for (const it of visibleItems) {
          if (on) next.add(it.id);
          else next.delete(it.id);
        }
        return next;
      });
    },
    [visibleItems],
  );

  const summary = (itemId: string): MediaOptionSummaryDTO | undefined => options[itemId];
  const sel = (itemId: string): DownloadOptionsDTO => rowSel[itemId] ?? {};
  const setSel = (itemId: string, patch: DownloadOptionsDTO): void =>
    setRowSel((prev) => ({ ...prev, [itemId]: { ...prev[itemId], ...patch } }));

  const hiddenChecked = selectedItems.length - visibleSelected.length;

  const hasResults = items.length > 0;
  const keywordFiltering = keyword.trim().length > 0;

  return (
    <div>
            <div className="hero">
        <div className="hero-mark">
          <LogoIcon />
        </div>
        <h1 className="hero-title">Bili23 Web</h1>
        <p className="hero-sub">{t("parse.subtitle")}</p>

        {/* 类型选择（真入口：切换输入形态并驱动 /api/parse 的 type 参数） */}
        <div className="type-chips" role="tablist" aria-label={t("parse.typeHint")}>
          {PARSE_TYPES.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={mode === p.id}
              className={`type-chip${mode === p.id ? " active" : ""}`}
              onClick={() => setMode(p.id)}
            >
              {t(p.labelKey)}
            </button>
          ))}
        </div>

        <div className="search-card">
          <div className="search-box">
            <span className="search-icon">
              <SearchIcon />
            </span>
            {kind === "link" && (
              <textarea
                className="search-input"
                rows={2}
                placeholder={t("parse.urlPlaceholder")}
                value={urlText}
                onChange={(e) => setUrlText(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                    e.preventDefault();
                    if (!parsing && canParse(mode, urlText, spaceInput)) void parse();
                  }
                }}
              />
            )}
            {kind === "space" && (
              <div className="search-input" style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
                <input
                  className="type-field"
                  placeholder={t("parse.placeholder.space")}
                  value={spaceInput}
                  onChange={(e) => setSpaceInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !parsing && canParse(mode, urlText, spaceInput)) void parse();
                  }}
                />
                <input
                  className="type-field"
                  placeholder={t("parse.placeholder.keyword")}
                  value={typeKeyword}
                  onChange={(e) => setTypeKeyword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !parsing && canParse(mode, urlText, spaceInput)) void parse();
                  }}
                />
              </div>
            )}
            {kind === "popular" && (
              <div className="search-input" style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
                <input
                  className="type-field"
                  type="number"
                  min={1}
                  step={1}
                  placeholder={t("parse.placeholder.week")}
                  value={weekText}
                  onChange={(e) => setWeekText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !parsing) void parse();
                  }}
                />
              </div>
            )}
            {kind === "auth" && (
              <div className="search-input" style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
                <input
                  className="type-field"
                  placeholder={t("parse.placeholder.keyword")}
                  value={typeKeyword}
                  onChange={(e) => setTypeKeyword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !parsing && auth.loggedIn) void parse();
                  }}
                />
                {!auth.loggedIn && (
                  <span className="auth-note" style={{ display: "block", fontSize: 13, fontWeight: 500 }}>
                    {t("parse.loginHint")}{" "}
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ marginLeft: 6 }}
                      onClick={onGoSettings}
                    >
                      {t("parse.loginGo")}
                    </button>
                  </span>
                )}
              </div>
            )}
          </div>
          <button
            className="btn btn-primary btn-lg"
            disabled={parsing || !canParse(mode, urlText, spaceInput) || (needsLogin && !auth.loggedIn)}
            onClick={() => void parse()}
          >
            {parsing ? (
              <>
                <span className="spinner" />
                {t("parse.parsingBtn")}
              </>
            ) : (
              <>
                <SearchIcon />
                {t("parse.button")}
              </>
            )}
          </button>
        </div>

        <p className="hero-limit">
          {kind === "space"
            ? t("parse.spaceHint")
            : kind === "popular"
              ? t("parse.popularHint")
              : kind === "auth"
                ? auth.loggedIn
                  ? t("parse.loginOk")
                  : `${t("parse.loginHint")} · ${t("parse.loginNeed")}`
                : t("parse.typeHint")}
        </p>
      </div>

      {error && <div className="error-text">{error}</div>}

      {hasResults && (
        <div className="fade-in">
          {/* 关键词筛选 */}
          <div className="search-bar" style={{ marginTop: 14 }}>
            <div className="search-box">
              <span className="search-icon">
                <SearchIcon />
              </span>
              <input
                className="search-input"
                type="search"
                placeholder={t("parse.filterPlaceholder")}
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
            </div>
          </div>

          {/* 选择工具栏 */}
          <div className="chip-row">
            <span className="muted" style={{ alignSelf: "center" }}>
              {t("parse.matchLine", {
                visible: visibleItems.length,
                total: items.length,
                selected: visibleSelected.length,
              })}
              {hiddenChecked > 0 ? ` ${t("parse.hiddenNote", { count: hiddenChecked })}` : ""}
            </span>
            <span className="topbar-spacer" />
            <button className="btn btn-ghost btn-sm" disabled={visibleItems.length === 0} onClick={() => setAllVisible(true)}>
              {t("parse.selectAll")}
            </button>
            <button className="btn btn-ghost btn-sm" disabled={visibleItems.length === 0} onClick={() => setAllVisible(false)}>
              {t("parse.selectNone")}
            </button>
            <button
              className="btn btn-brand btn-sm"
              disabled={busy !== null || visibleSelected.length === 0}
              onClick={() => void startBatch()}
            >
              <DownloadIcon />
              {busy === BATCH_BUSY ? t("common.creating") : t("parse.batch", { count: visibleSelected.length })}
            </button>
          </div>

          {/* 结果卡片网格 */}
          <div className={`grid stagger${keywordFiltering ? "" : ""}`}>
            {parsing ? (
              Array.from({ length: 8 }).map((_, i) => (
                <div className="media-card" key={i}>
                  <div className="media-cover">
                    <div className="skeleton" style={{ width: "100%", height: "100%" }} />
                  </div>
                  <div className="media-body">
                    <div className="skeleton" style={{ height: 14, marginBottom: 8 }} />
                    <div className="skeleton" style={{ height: 12, width: "60%" }} />
                  </div>
                </div>
              ))
            ) : (
              visibleItems.map((item) => (
                <Fragment key={item.id}>
                  <div
                    className={`media-card${checked.has(item.id) ? " selected" : ""}`}
                    onClick={() => toggle(item.id)}
                    role="checkbox"
                    aria-checked={checked.has(item.id)}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === " " || e.key === "Enter") {
                        e.preventDefault();
                        toggle(item.id);
                      }
                    }}
                  >
                    <div className="media-cover">
                      {item.cover ? <img src={item.cover} alt="" loading="lazy" /> : null}
                      <span className="media-duration">{formatDuration(item.duration)}</span>
                      <span className="media-check">
                        <CheckIcon />
                      </span>
                    </div>
                    <div className="media-body">
                      <div className="media-title">{item.title}</div>
                      <div className="media-meta">
                        <span className="muted">{item.groupTitle}</span>
                        {item.interactive ? (
                          <span className="tag brand">{t("parse.interactiveTag")}</span>
                        ) : null}
                        {item.badge ? <span className="tag danger">{item.badge}</span> : null}
                        <button
                          className="btn btn-soft btn-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            void loadOptions(item);
                          }}
                        >
                          {expanded === item.id ? t("parse.optionsBtn") : t("parse.optionsBtn")}
                        </button>
                      </div>
                    </div>
                  </div>
                  {expanded === item.id && (
                    <div className="option-panel" style={{ gridColumn: "1 / -1" }}>
                      <OptionPanel
                        item={item}
                        summary={summary(item.id)}
                        value={sel(item.id)}
                        busy={busy !== null}
                        onChange={(patch) => setSel(item.id, patch)}
                        onDownload={() => void startDownload([item.id], sel(item.id))}
                      />
                    </div>
                  )}
                </Fragment>
              ))
            )}
          </div>

          {!parsing && visibleItems.length === 0 && (
            <div className="empty">{keywordFiltering ? t("parse.emptyFilter") : t("parse.emptyResult")}</div>
          )}
        </div>
      )}
    </div>
  );
}

function OptionPanel(props: {
  item: MediaItemDTO;
  summary?: MediaOptionSummaryDTO | undefined;
  value: DownloadOptionsDTO;
  busy: boolean;
  onChange: (patch: DownloadOptionsDTO) => void;
  onDownload: () => void;
}) {
  const { item, summary, value, busy, onChange, onDownload } = props;
  const { t } = useI18n();
  const quality = value.videoQualityId ?? 200;
  const codecs =
    summary?.qualities.find((q) => q.id === quality)?.codecs ??
    summary?.qualities[0]?.codecs ??
    [];
  const audioId = value.audioQualityId ?? 0;
  const patchExtras = (patch: ExtrasOptionsDTO): void => {
    onChange({ extras: { ...(value.extras ?? {}), ...patch } });
  };
  return (
    <div>
      {!summary ? (
        <p className="muted" style={{ margin: 0 }}>
          {t("parse.loadingOptions")}
        </p>
      ) : (
        <>
          <div className="field-row">
            <label className="field-label">
              <span>{t("parse.quality")}</span>
              <select
                value={quality}
                onChange={(e) => onChange({ videoQualityId: Number(e.target.value), videoCodecId: 20 })}
              >
                <option value={200}>{t("parse.auto")}</option>
                {summary.qualities.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              <span>{t("parse.codec")}</span>
              <select
                value={value.videoCodecId ?? 20}
                onChange={(e) => onChange({ videoCodecId: Number(e.target.value) })}
              >
                <option value={20}>{t("parse.auto")}</option>
                {codecs.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            {summary.audioQualities.length > 0 && (
              <label className="field-label">
                <span>{t("parse.audioQuality")}</span>
                <select
                  value={audioId}
                  onChange={(e) => onChange({ audioQualityId: Number(e.target.value) })}
                >
                  <option value={0}>{t("parse.auto")}</option>
                  {summary.audioQualities.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="field-label">
              <span>{t("parse.container")}</span>
              <select
                value={value.container ?? "mp4"}
                onChange={(e) => onChange({ container: e.target.value as "mp4" | "mkv" })}
              >
                <option value="mp4">MP4</option>
                <option value="mkv">MKV</option>
              </select>
            </label>
            <label className="field-label" style={{ justifyContent: "flex-end" }}>
              <span>&nbsp;</span>
              <button className="btn btn-primary" disabled={busy} onClick={onDownload}>
                <DownloadIcon />
                {busy ? t("common.creating") : t("parse.downloadItem", { title: item.title })}
              </button>
            </label>
          </div>
          <div style={{ marginTop: 4, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
            <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>{t("parse.extrasTitle")}</div>
            <ExtrasEditor value={value.extras ?? {}} onChange={patchExtras} />
          </div>
        </>
      )}
    </div>
  );
}

const DANMAKU_FORMAT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "xml", label: "XML" },
  { value: "ass", label: "ASS" },
  { value: "json", label: "JSON" },
];

const SUBTITLE_FORMAT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "srt", label: "SRT" },
  { value: "lrc", label: "LRC" },
  { value: "txt", label: "TXT" },
  { value: "ass", label: "ASS" },
  { value: "json", label: "JSON" },
];

const COVER_FORMAT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "jpg", label: "JPG" },
  { value: "png", label: "PNG" },
  { value: "avif", label: "AVIF" },
  { value: "webp", label: "WEBP" },
];

const METADATA_FORMAT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "nfo", label: "NFO" },
  { value: "json", label: "JSON" },
];

function ExtrasEditor(props: { value: ExtrasOptionsDTO; onChange: (patch: ExtrasOptionsDTO) => void }) {
  const { value, onChange } = props;
  const { t } = useI18n();
  return (
    <div className="field-row" style={{ gap: 16 }}>
      <ExtraRow
        label={t("parse.extra.danmaku")}
        enabled={value.danmaku?.enabled}
        format={value.danmaku?.format}
        formats={DANMAKU_FORMAT_OPTIONS}
        onEnabled={(v) => onChange({ danmaku: { ...value.danmaku, enabled: v } })}
        onFormat={(v) => onChange({ danmaku: { ...value.danmaku, format: v as DanmakuFormatDTO } })}
      />
      <ExtraRow
        label={t("parse.extra.subtitle")}
        enabled={value.subtitle?.enabled}
        format={value.subtitle?.format}
        formats={SUBTITLE_FORMAT_OPTIONS}
        onEnabled={(v) => onChange({ subtitle: { ...value.subtitle, enabled: v } })}
        onFormat={(v) => onChange({ subtitle: { ...value.subtitle, format: v as SubtitleFormatDTO } })}
      />
      <ExtraRow
        label={t("parse.extra.cover")}
        enabled={value.cover?.enabled}
        format={value.cover?.format}
        formats={COVER_FORMAT_OPTIONS}
        onEnabled={(v) => onChange({ cover: { ...value.cover, enabled: v } })}
        onFormat={(v) => onChange({ cover: { ...value.cover, format: v as CoverFormatDTO } })}
      />
      <ExtraRow
        label={t("parse.extra.metadata")}
        enabled={value.metadata?.enabled}
        format={value.metadata?.format}
        formats={METADATA_FORMAT_OPTIONS}
        onEnabled={(v) => onChange({ metadata: { ...value.metadata, enabled: v } })}
        onFormat={(v) => onChange({ metadata: { ...value.metadata, format: v as MetadataFormatDTO } })}
      />
    </div>
  );
}

function ExtraRow(props: {
  label: string;
  enabled: boolean | undefined;
  format: string | undefined;
  formats: Array<{ value: string; label: string }>;
  onEnabled: (enabled: boolean) => void;
  onFormat: (format: string) => void;
}) {
  const { label, enabled, format, formats, onEnabled, onFormat } = props;
  const { t } = useI18n();
  return (
    <div className="field-row" style={{ gap: 16 }}>
      <label className="field-label" style={{ flexDirection: "row", alignItems: "center", gap: 6, minWidth: 150 }}>
        <input type="checkbox" checked={enabled ?? false} onChange={(e) => onEnabled(e.target.checked)} />
        {label}
      </label>
      <label className="field-label" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <span>{t("parse.extra.format")}</span>
        <select value={format ?? ""} onChange={(e) => onFormat(e.target.value)}>
          <option value="" disabled>
            {t("parse.extra.default")}
          </option>
          {formats.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
