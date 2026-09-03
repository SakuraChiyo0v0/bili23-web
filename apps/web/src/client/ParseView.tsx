import { useCallback, useMemo, useState } from "react";
import type {
  DownloadOptionsDTO,
  MediaItemDTO,
  MediaOptionSummaryDTO,
  ParseResultDTO,
} from "./types.js";
import { formatDuration } from "./types.js";

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok || (json as { error?: unknown }).error) {
    throw new Error(json.error?.message ?? `请求失败（HTTP ${res.status}）`);
  }
  return json;
}

interface Props {
  onCreated: () => void;
  onGoDownload: () => void;
}

export function ParseView({ onCreated, onGoDownload }: Props) {
  const [urlText, setUrlText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<ParseResultDTO[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [options, setOptions] = useState<Record<string, MediaOptionSummaryDTO>>({});
  const [rowSel, setRowSel] = useState<Record<string, DownloadOptionsDTO>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const items = useMemo(() => {
    const list: MediaItemDTO[] = [];
    for (const r of results) for (const it of r.items) list.push(it);
    return list;
  }, [results]);

  const selectedItems = useMemo(() => items.filter((i) => checked.has(i.id)), [items, checked]);

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

  const loadOptions = useCallback(async (item: MediaItemDTO) => {
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
  }, [options]);

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

  const toggle = useCallback((id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const summary = (itemId: string): MediaOptionSummaryDTO | undefined => options[itemId];
  const sel = (itemId: string): DownloadOptionsDTO => rowSel[itemId] ?? {};
  const setSel = (itemId: string, patch: DownloadOptionsDTO): void =>
    setRowSel((prev) => ({ ...prev, [itemId]: { ...prev[itemId], ...patch } }));

  return (
    <div>
      <h2>解析</h2>
      <textarea
        rows={3}
        style={{ width: "100%", boxSizing: "border-box", fontFamily: "inherit", padding: 8 }}
        placeholder={"粘贴 B 站链接，可一次多条（每行一条）：\nhttps://www.bilibili.com/video/BVxxxx"}
        value={urlText}
        onChange={(e) => setUrlText(e.target.value)}
      />
      <div style={{ margin: "8px 0" }}>
        <button disabled={parsing || urlText.trim().length === 0} onClick={() => void parse()}>
          {parsing ? "解析中…" : "解析"}
        </button>{" "}
        <button
          disabled={items.length === 0}
          onClick={() => {
            setResults([]);
            setChecked(new Set());
            setOptions({});
            setExpanded(null);
          }}
        >
          清空
        </button>
      </div>
      {error && <p style={{ color: "#c0392b" }}>{error}</p>}

      {items.length > 0 && (
        <div>
          <p>
            共 {items.length} 个条目，已选 {selectedItems.length} 个。
          </p>
          {selectedItems.length > 1 && (
            <button
              disabled={busy !== null}
              onClick={() => void startDownload(selectedItems.map((i) => i.id), {})}
            >
              批量下载所选 {selectedItems.length} 项（自动画质）
            </button>
          )}
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {items.map((item) => (
              <li key={item.id} style={{ border: "1px solid #ddd", borderRadius: 8, marginBottom: 8, padding: 8 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <input type="checkbox" checked={checked.has(item.id)} onChange={() => toggle(item.id)} />
                  {item.cover ? (
                    <img src={item.cover} alt="" width={96} height={60} style={{ objectFit: "cover", borderRadius: 4 }} />
                  ) : (
                    <div style={{ width: 96, height: 60, background: "#eee", borderRadius: 4 }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{item.title}</div>
                    <div style={{ color: "#666", fontSize: 13 }}>
                      {item.groupTitle} · {formatDuration(item.duration)}
                      {item.bvid ? ` · BV${item.bvid}` : ""}
                      {item.interactive ? <span style={{ color: "#7d3c98" }}> · 互动</span> : null}
                      {item.badge ? <span style={{ color: "#c0392b" }}> · {item.badge}</span> : null}
                    </div>
                  </div>
                  <button onClick={() => void loadOptions(item)}>选项 / 下载</button>
                </div>
                {expanded === item.id && (
                  <OptionPanel
                    key={item.id}
                    item={item}
                    summary={summary(item.id)}
                    value={sel(item.id)}
                    busy={busy === item.id}
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
  const quality = value.videoQualityId ?? 200;
  const codecs =
    summary?.qualities.find((q) => q.id === quality)?.codecs ??
    summary?.qualities[0]?.codecs ??
    [];
  const audioId = value.audioQualityId ?? 0;
  return (
    <div style={{ marginTop: 8, padding: 10, background: "#f6f8fa", borderRadius: 6 }}>
      {!summary ? (
        <p style={{ color: "#888", margin: 0 }}>加载可选画质中…</p>
      ) : (
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "end" }}>
          <label>
            画质
            <select
              value={quality}
              onChange={(e) => onChange({ videoQualityId: Number(e.target.value), videoCodecId: 20 })}
            >
              <option value={200}>自动</option>
              {summary.qualities.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            编码
            <select
              value={value.videoCodecId ?? 20}
              onChange={(e) => onChange({ videoCodecId: Number(e.target.value) })}
            >
              <option value={20}>自动</option>
              {codecs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          {summary.audioQualities.length > 0 && (
            <label>
              音质
              <select value={audioId} onChange={(e) => onChange({ audioQualityId: Number(e.target.value) })}>
                <option value={0}>自动</option>
                {summary.audioQualities.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            容器
            <select
              value={value.container ?? "mp4"}
              onChange={(e) => onChange({ container: e.target.value as "mp4" | "mkv" })}
            >
              <option value="mp4">MP4</option>
              <option value="mkv">MKV</option>
            </select>
          </label>
          <button disabled={busy} onClick={onDownload}>
            {busy ? "创建中…" : `下载「${item.title}」`}
          </button>
        </div>
      )}
    </div>
  );
}


