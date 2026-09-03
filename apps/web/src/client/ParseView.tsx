import { useCallback, useMemo, useState } from "react";
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
} from "./types.js";
import { formatDuration } from "./types.js";
import { useI18n } from "./i18n.js";

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
}

const BATCH_BUSY = "__batch__";

export function ParseView({ onCreated, onGoDownload }: Props) {
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
      const urls = urlText
        .split(/\r?\n|,|;/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const { results: parsed } = await postJson<{ results: ParseResultDTO[] }>("/api/parse", { urls });
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
  }, [urlText]);

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

  return (
    <div>
      <h2 style={{ margin: 0 }}>{t("parse.title")}</h2>
      <textarea
        rows={3}
        style={{
          width: "100%",
          boxSizing: "border-box",
          fontFamily: "inherit",
          padding: 8,
          marginTop: 10,
        }}
        placeholder={t("parse.urlPlaceholder")}
        value={urlText}
        onChange={(e) => setUrlText(e.target.value)}
      />
      <div style={{ margin: "8px 0" }}>
        <button disabled={parsing || urlText.trim().length === 0} onClick={() => void parse()}>
          {parsing ? t("parse.parsingBtn") : t("parse.button")}
        </button>{" "}
        <button
          disabled={items.length === 0}
          onClick={() => {
            setResults([]);
            setChecked(new Set());
            setOptions({});
            setExpanded(null);
            setKeyword("");
          }}
        >
          {t("parse.clear")}
        </button>
      </div>
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}

      {items.length > 0 && (
        <div>
          <input
            type="search"
            placeholder={t("parse.filterPlaceholder")}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", margin: "4px 0" }}
          />
          <p style={{ margin: "6px 0", color: "var(--text-2)" }}>
            {t("parse.matchLine", {
              visible: visibleItems.length,
              total: items.length,
              selected: visibleSelected.length,
            })}
            {hiddenChecked > 0 ? ` ${t("parse.hiddenNote", { count: hiddenChecked })}` : ""}
          </p>
          <div style={{ marginBottom: 10 }}>
            <button disabled={visibleItems.length === 0} onClick={() => setAllVisible(true)}>
              {t("parse.selectAll")}
            </button>{" "}
            <button disabled={visibleItems.length === 0} onClick={() => setAllVisible(false)}>
              {t("parse.selectNone")}
            </button>{" "}
            <button
              disabled={busy !== null || visibleSelected.length === 0}
              onClick={() => void startBatch()}
            >
              {busy === BATCH_BUSY ? t("common.creating") : t("parse.batch", { count: visibleSelected.length })}
            </button>
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {visibleItems.map((item) => (
              <li
                key={item.id}
                style={{
                  border: "1px solid var(--border-strong)",
                  borderRadius: 8,
                  marginBottom: 8,
                  padding: 8,
                  background: "var(--surface)",
                }}
              >
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <input type="checkbox" checked={checked.has(item.id)} onChange={() => toggle(item.id)} />
                  {item.cover ? (
                    <img
                      src={item.cover}
                      alt=""
                      width={96}
                      height={60}
                      style={{ objectFit: "cover", borderRadius: 4 }}
                    />
                  ) : (
                    <div style={{ width: 96, height: 60, background: "var(--surface-2)", borderRadius: 4 }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{item.title}</div>
                    <div style={{ color: "var(--text-2)", fontSize: 13 }}>
                      {item.groupTitle} · {formatDuration(item.duration)}
                      {item.bvid ? ` · BV${item.bvid}` : ""}
                      {item.interactive ? (
                        <span style={{ color: "var(--accent)" }}> · {t("parse.interactiveTag")}</span>
                      ) : null}
                      {item.badge ? <span style={{ color: "var(--danger)" }}> · {item.badge}</span> : null}
                    </div>
                  </div>
                  <button onClick={() => void loadOptions(item)}>{t("parse.optionsBtn")}</button>
                </div>
                {expanded === item.id && (
                  <OptionPanel
                    key={item.id}
                    item={item}
                    summary={summary(item.id)}
                    value={sel(item.id)}
                    busy={busy !== null}
                    onChange={(patch) => setSel(item.id, patch)}
                    onDownload={() => void startDownload([item.id], sel(item.id))}
                  />
                )}
              </li>
            ))}
          </ul>
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
    <div
      style={{
        marginTop: 8,
        padding: 10,
        background: "var(--surface-2)",
        borderRadius: 6,
        border: "1px solid var(--border)",
      }}
    >
      {!summary ? (
        <p style={{ color: "var(--text-3)", margin: 0 }}>{t("parse.loadingOptions")}</p>
      ) : (
        <>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "end" }}>
            <label>
              {t("parse.quality")}
              <select
                value={quality}
                onChange={(e) => onChange({ videoQualityId: Number(e.target.value), videoCodecId: 20 })}
                style={{ marginLeft: 6 }}
              >
                <option value={200}>{t("parse.auto")}</option>
                {summary.qualities.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("parse.codec")}
              <select
                value={value.videoCodecId ?? 20}
                onChange={(e) => onChange({ videoCodecId: Number(e.target.value) })}
                style={{ marginLeft: 6 }}
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
              <label>
                {t("parse.audioQuality")}
                <select
                  value={audioId}
                  onChange={(e) => onChange({ audioQualityId: Number(e.target.value) })}
                  style={{ marginLeft: 6 }}
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
            <label>
              {t("parse.container")}
              <select
                value={value.container ?? "mp4"}
                onChange={(e) => onChange({ container: e.target.value as "mp4" | "mkv" })}
                style={{ marginLeft: 6 }}
              >
                <option value="mp4">MP4</option>
                <option value="mkv">MKV</option>
              </select>
            </label>
            <button disabled={busy} onClick={onDownload}>
              {busy ? t("common.creating") : t("parse.downloadItem", { title: item.title })}
            </button>
          </div>
          <div style={{ marginTop: 10, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>{t("parse.extrasTitle")}</div>
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
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
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
    <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 4, minWidth: 150 }}>
        <input type="checkbox" checked={enabled ?? false} onChange={(e) => onEnabled(e.target.checked)} />
        {label}
      </label>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        {t("parse.extra.format")}
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