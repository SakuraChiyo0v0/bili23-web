import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AppConfigDTO,
  ChapterOptionsDTO,
  CoverFormatDTO,
  CoverOptionsDTO,
  DanmakuFormatDTO,
  DanmakuOptionsDTO,
  ExtrasOptionsDTO,
  MetadataFormatDTO,
  MetadataOptionsDTO,
  NamingRuleDTO,
  SubtitleFormatDTO,
  SubtitleOptionsDTO,
} from "./types.js";

/** 命名模板变量提示（引擎变量目录的中文子集；点击可插入输入框） */
interface VarToken {
  token: string;
  hint: string;
}

type Notice = { group: "naming" | "additional"; kind: "ok" | "err"; text: string };

const TYPE_LABEL: Record<number, string> = {
  11: "普通视频",
  12: "分P",
  13: "合集",
  14: "互动视频",
  20: "番剧",
  30: "课堂",
  31: "商城课",
  40: "收藏夹",
  50: "空间",
  60: "历史",
  70: "稍后再看",
  80: "每周必看",
  90: "音乐",
};

const NUMBERING_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 2, label: "连续编号" },
  { value: 0, label: "指定起始" },
  { value: 1, label: "解析列表序号" },
];

const COMMON_TOKENS: VarToken[] = [
  { token: "{number}", hint: "下载编号（按编号模式自动分配）" },
  { token: "{uploader}", hint: "UP 主昵称" },
  { token: "{uploader_uid}", hint: "UP 主 UID" },
  { token: "{pub_time:%Y-%m-%d}", hint: "发布日期，可自定义格式" },
  { token: "{create_time:%Y-%m-%d}", hint: "任务创建日期，可自定义格式" },
  { token: "{video_quality}", hint: "画质（如 1080P）" },
  { token: "{audio_quality}", hint: "音质（如 192K）" },
  { token: "{video_codec}", hint: "编码（如 HEVC）" },
];

const ID_TOKENS: VarToken[] = [
  { token: "{aid}", hint: "稿件 aid" },
  { token: "{bvid}", hint: "稿件 bvid" },
  { token: "{cid}", hint: "分P cid" },
];

const TYPE_TOKENS: Record<number, VarToken[]> = {
  11: [{ token: "{leaf_title}", hint: "视频标题" }, ...COMMON_TOKENS, ...ID_TOKENS],
  12: [
    { token: "{parent_title}", hint: "主视频标题" },
    { token: "{p}", hint: "分P 序号（可补零如 {p:02d}）" },
    { token: "{leaf_title}", hint: "分P 标题" },
    ...COMMON_TOKENS,
    ...ID_TOKENS,
  ],
  13: [
    { token: "{collection_title}", hint: "合集标题" },
    { token: "{section_title}", hint: "分节标题" },
    { token: "{parent_title}", hint: "视频标题" },
    { token: "{leaf_title}", hint: "分P 标题" },
    { token: "{p}", hint: "分P 序号" },
    ...COMMON_TOKENS,
    ...ID_TOKENS,
  ],
  14: [
    { token: "{parent_title}", hint: "互动视频主标题" },
    { token: "{leaf_title}", hint: "节点标题" },
    ...COMMON_TOKENS,
    ...ID_TOKENS,
  ],
  20: [
    { token: "{season_title}", hint: "季标题（如 轻音少女 第二季）" },
    { token: "{series_title}", hint: "系列标题（如 轻音少女）" },
    { token: "{section_title}", hint: "分节标题（如 正片）" },
    { token: "{episode_title}", hint: "剧集标题" },
    { token: "{episode_number}", hint: "集号" },
    { token: "{season_number}", hint: "季号" },
    { token: "{ep_id}", hint: "分集 ep_id" },
    { token: "{season_id}", hint: "季 season_id" },
    ...COMMON_TOKENS,
  ],
  30: [
    { token: "{series_title}", hint: "课程标题" },
    { token: "{section_title}", hint: "分节标题" },
    { token: "{episode_title}", hint: "课节标题" },
    { token: "{ep_id}", hint: "课节 ep_id" },
    { token: "{season_id}", hint: "课程 season_id" },
    ...COMMON_TOKENS,
  ],
  31: [
    { token: "{series_title}", hint: "课程标题" },
    { token: "{section_title}", hint: "分节标题" },
    { token: "{episode_title}", hint: "课节标题" },
    { token: "{course_id}", hint: "课程 ID" },
    { token: "{lesson_id}", hint: "课节 ID" },
    { token: "{section_id}", hint: "章节 ID" },
    { token: "{item_id}", hint: "课时 ID" },
    ...COMMON_TOKENS,
  ],
  40: [
    { token: "{favorites_name}", hint: "收藏夹名称" },
    { token: "{favorites_owner}", hint: "收藏夹主人昵称" },
    { token: "{favorites_owner_id}", hint: "收藏夹主人 UID" },
    { token: "{favorites_id}", hint: "收藏夹 ID" },
    { token: "{parent_title}", hint: "视频标题" },
    { token: "{leaf_title}", hint: "分P 标题" },
    { token: "{fav_time:%Y-%m-%d}", hint: "收藏日期，可自定义格式" },
    ...COMMON_TOKENS,
  ],
  50: [
    { token: "{space_owner}", hint: "空间主人昵称" },
    { token: "{space_owner_id}", hint: "空间主人 UID" },
    { token: "{parent_title}", hint: "视频标题" },
    { token: "{leaf_title}", hint: "分P 标题" },
    ...COMMON_TOKENS,
  ],
  60: [
    { token: "{parent_title}", hint: "父级标题（历史记录）" },
    { token: "{leaf_title}", hint: "视频标题" },
    { token: "{last_watched_time:%Y-%m-%d}", hint: "最近观看日期，可自定义格式" },
    ...COMMON_TOKENS,
  ],
  70: [
    { token: "{parent_title}", hint: "父级标题（稍后再看）" },
    { token: "{leaf_title}", hint: "视频标题" },
    { token: "{fav_time:%Y-%m-%d}", hint: "收藏日期，可自定义格式" },
    ...COMMON_TOKENS,
  ],
  80: [
    { token: "{parent_title}", hint: "父级标题（期数，如 第377期）" },
    { token: "{leaf_title}", hint: "视频标题" },
    ...COMMON_TOKENS,
  ],
  90: [
    { token: "{leaf_title}", hint: "歌曲名称" },
    { token: "{parent_title}", hint: "歌单名称" },
    { token: "{uploader}", hint: "歌手" },
    { token: "{pub_time:%Y-%m-%d}", hint: "发布日期，可自定义格式" },
    { token: "{number}", hint: "下载编号" },
    { token: "{audio_quality}", hint: "音质（如 192K）" },
  ],
};

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const json = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok || (json as { error?: unknown }).error) {
    throw new Error(json.error?.message ?? `请求失败（HTTP ${res.status}）`);
  }
  return json;
}

async function putJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok || (json as { error?: unknown }).error) {
    throw new Error(json.error?.message ?? `请求失败（HTTP ${res.status}）`);
  }
  return json;
}

export function SettingsView() {
  const [cfg, setCfg] = useState<AppConfigDTO | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [saving, setSaving] = useState<"naming" | "additional" | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [startText, setStartText] = useState("1");
  const [langInput, setLangInput] = useState("");
  const ruleRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const load = useCallback(async () => {
    setLoadErr("");
    setNotice(null);
    try {
      const { config } = await getJson<{ config: AppConfigDTO }>("/api/config");
      setCfg(config);
      setStartText(String(config.fileNaming?.startingNumber ?? 1));
      setLangInput(config.additional?.subtitle?.language?.specifiedLanguages?.join(",") ?? "");
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const updateRule = useCallback((ruleId: string, rule: string): void => {
    setCfg((prev) => {
      if (!prev) return prev;
      const rules = prev.fileNaming?.rules ?? [];
      return {
        ...prev,
        fileNaming: {
          ...(prev.fileNaming ?? {}),
          rules: rules.map((r) => (r.id === ruleId ? { ...r, rule } : r)),
        },
      };
    });
  }, []);

  const insertVar = useCallback((ruleId: string, token: string): void => {
    const el = ruleRefs.current[ruleId];
    const start = el?.selectionStart ?? 0;
    const end = el?.selectionEnd ?? start;
    const current = el?.value ?? "";
    updateRule(ruleId, current.slice(0, start) + token + current.slice(end));
    if (el) {
      window.requestAnimationFrame(() => {
        el.focus();
        const pos = start + token.length;
        el.setSelectionRange(pos, pos);
      });
    }
  }, [updateRule]);

  const setNumberingType = useCallback((value: number): void => {
    setCfg((prev) =>
      prev
        ? {
            ...prev,
            fileNaming: { ...(prev.fileNaming ?? {}), numberingType: value },
          }
        : prev,
    );
  }, []);

  const patchAdditional = useCallback(
    (patch: (prev: ExtrasOptionsDTO) => ExtrasOptionsDTO): void => {
      setCfg((prev) => (prev ? { ...prev, additional: patch(prev.additional ?? {}) } : prev));
    },
    [],
  );

  const patchDanmaku = (patch: DanmakuOptionsDTO): void =>
    patchAdditional((prev) => ({ ...prev, danmaku: { ...prev.danmaku, ...patch } }));
  const patchSubtitle = (patch: SubtitleOptionsDTO): void =>
    patchAdditional((prev) => ({ ...prev, subtitle: { ...prev.subtitle, ...patch } }));
  const patchCover = (patch: CoverOptionsDTO): void =>
    patchAdditional((prev) => ({ ...prev, cover: { ...prev.cover, ...patch } }));
  const patchChapter = (patch: ChapterOptionsDTO): void =>
    patchAdditional((prev) => ({ ...prev, chapter: { ...prev.chapter, ...patch } }));
  const patchMetadata = (patch: MetadataOptionsDTO): void =>
    patchAdditional((prev) => ({ ...prev, metadata: { ...prev.metadata, ...patch } }));

  const saveNaming = useCallback(async () => {
    if (!cfg) return;
    setSaving("naming");
    setNotice(null);
    try {
      const fn = cfg.fileNaming ?? {};
      const parsed = Math.floor(Number(startText));
      const startingNumber = Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
      const { config } = await putJson<{ config: AppConfigDTO }>("/api/config", {
        config: {
          fileNaming: {
            rules: fn.rules ?? [],
            numberingType: fn.numberingType ?? 2,
            startingNumber,
          },
        },
      });
      setCfg(config);
      setStartText(String(config.fileNaming?.startingNumber ?? startingNumber));
      setNotice({ group: "naming", kind: "ok", text: "文件命名设置已保存" });
    } catch (e) {
      setNotice({ group: "naming", kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(null);
    }
  }, [cfg, startText]);

  const saveAdditional = useCallback(async () => {
    if (!cfg?.additional) return;
    setSaving("additional");
    setNotice(null);
    try {
      const { config } = await putJson<{ config: AppConfigDTO }>("/api/config", {
        config: { additional: cfg.additional },
      });
      setCfg(config);
      setLangInput(config.additional?.subtitle?.language?.specifiedLanguages?.join(",") ?? "");
      setNotice({ group: "additional", kind: "ok", text: "附加内容设置已保存" });
    } catch (e) {
      setNotice({ group: "additional", kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(null);
    }
  }, [cfg]);

  if (loadErr && !cfg) {
    return (
      <div>
        <h2>设置</h2>
        <p style={{ color: "#c0392b" }}>配置加载失败：{loadErr}</p>
        <button onClick={() => void load()}>重试</button>
      </div>
    );
  }

  if (!cfg) {
    return (
      <div>
        <h2>设置</h2>
        <p style={{ color: "#888" }}>加载中…</p>
      </div>
    );
  }

  const rules = cfg.fileNaming?.rules ?? [];
  const numberingType = cfg.fileNaming?.numberingType ?? 2;
  const additional = cfg.additional ?? {};
  const danmaku = additional.danmaku ?? {};
  const subtitle = additional.subtitle ?? {};
  const cover = additional.cover ?? {};
  const chapter = additional.chapter ?? {};
  const metadata = additional.metadata ?? {};
  const useParseList = numberingType === 1;

  return (
    <div>
      <h2>设置</h2>

      <section style={{ marginBottom: 24 }}>
        <h3>文件命名</h3>
        <p style={{ color: "#666", fontSize: 13 }}>
          每种内容类型一条模板；模板中 / 表示生成子目录，支持 {`{变量}`}、日期格式与补零（如
          {`{p:02d}`}）。
        </p>
        {notice && notice.group === "naming" && (
          <p style={{ color: notice.kind === "ok" ? "#27ae60" : "#c0392b" }}>{notice.text}</p>
        )}
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "end", margin: "10px 0" }}>
          <label>
            编号模式
            <select
              value={numberingType}
              onChange={(e) => setNumberingType(Number(e.target.value))}
              style={{ display: "block", marginTop: 4 }}
            >
              {NUMBERING_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            起始编号
            <input
              type="number"
              min={1}
              step={1}
              value={startText}
              disabled={useParseList}
              onChange={(e) => setStartText(e.target.value)}
              style={{ display: "block", marginTop: 4, width: 90 }}
            />
          </label>
          <span style={{ color: "#888", fontSize: 12, maxWidth: 320 }}>
            {useParseList
              ? "解析列表序号模式：编号取批量创建时的解析顺序，起始编号不生效。"
              : "连续编号 / 指定起始：从该编号开始，每个任务依次 +1。"}
          </span>
        </div>
        <div style={{ marginBottom: 8 }}>
          <button disabled={saving !== null} onClick={() => void saveNaming()}>
            {saving === "naming" ? "保存中…" : "保存"}
          </button>
        </div>
        {rules.map((rule: NamingRuleDTO) => {
          const label = TYPE_LABEL[rule.type] ?? `类型 ${rule.type}`;
          const tokens = TYPE_TOKENS[rule.type] ?? [];
          return (
            <div
              key={rule.id}
              style={{ border: "1px solid #e5e5e5", borderRadius: 8, padding: 10, marginBottom: 10 }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <strong style={{ minWidth: 64 }}>{label}</strong>
                <span style={{ color: "#999", fontSize: 12 }}>{rule.name}</span>
              </div>
              <input
                ref={(el) => {
                  ruleRefs.current[rule.id] = el;
                }}
                value={rule.rule}
                onChange={(e) => updateRule(rule.id, e.target.value)}
                placeholder="命名模板，如 {parent_title}/P{p}-{leaf_title}"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "6px 8px",
                  fontFamily: "monospace",
                  borderRadius: 4,
                  border: "1px solid #ccc",
                }}
              />
              <div style={{ marginTop: 6, fontSize: 12 }}>
                <span style={{ color: "#666" }}>可用变量（点击插入）：</span>
                {tokens.length === 0 && (
                  <span style={{ color: "#999" }}>该类型暂无预设变量</span>
                )}
                {tokens.map((t) => (
                  <button
                    key={t.token}
                    type="button"
                    title={t.hint}
                    onClick={() => insertVar(rule.id, t.token)}
                    style={{
                      margin: "2px 4px 2px 0",
                      padding: "1px 6px",
                      fontSize: 12,
                      borderRadius: 10,
                      border: "1px dashed #999",
                      background: "#fafafa",
                      cursor: "pointer",
                      color: "#1a56db",
                      fontFamily: "monospace",
                    }}
                  >
                    {t.token}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      <section>
        <h3>附加内容（全局默认）</h3>
        <p style={{ color: "#666", fontSize: 13 }}>
          作为之后下载任务的默认附加内容；在「解析」页每一行展开选项时可单独覆盖本次下载。
        </p>
        {notice && notice.group === "additional" && (
          <p style={{ color: notice.kind === "ok" ? "#27ae60" : "#c0392b" }}>{notice.text}</p>
        )}
        <div style={{ margin: "10px 0" }}>
          <button disabled={saving !== null} onClick={() => void saveAdditional()}>
            {saving === "additional" ? "保存中…" : "保存"}
          </button>
        </div>

        <div style={{ border: "1px solid #e5e5e5", borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <strong>弹幕</strong>
          <label style={{ display: "block", marginTop: 8 }}>
            <input
              type="checkbox"
              checked={danmaku.enabled ?? false}
              onChange={(e) => patchDanmaku({ enabled: e.target.checked })}
            />{" "}
            下载弹幕
          </label>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
            <label>
              格式
              <select
                value={danmaku.format ?? "ass"}
                onChange={(e) => patchDanmaku({ format: e.target.value as DanmakuFormatDTO })}
                style={{ marginLeft: 6 }}
              >
                <option value="xml">XML</option>
                <option value="ass">ASS</option>
                <option value="json">JSON</option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                disabled={(danmaku.format ?? "ass") !== "ass"}
                checked={danmaku.embed ?? false}
                onChange={(e) => patchDanmaku({ embed: e.target.checked })}
              />{" "}
              内嵌进 MKV（仅 ASS + 输出 MKV 时生效）
            </label>
            <label>
              <input
                type="checkbox"
                disabled={(danmaku.embed ?? false) === false}
                checked={danmaku.deleteAfterEmbed ?? false}
                onChange={(e) => patchDanmaku({ deleteAfterEmbed: e.target.checked })}
              />{" "}
              内嵌成功后删除源文件
            </label>
          </div>
        </div>

        <div style={{ border: "1px solid #e5e5e5", borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <strong>字幕</strong>
          <label style={{ display: "block", marginTop: 8 }}>
            <input
              type="checkbox"
              checked={subtitle.enabled ?? false}
              onChange={(e) => patchSubtitle({ enabled: e.target.checked })}
            />{" "}
            下载字幕
          </label>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
            <label>
              格式
              <select
                value={subtitle.format ?? "ass"}
                onChange={(e) => patchSubtitle({ format: e.target.value as SubtitleFormatDTO })}
                style={{ marginLeft: 6 }}
              >
                <option value="srt">SRT</option>
                <option value="lrc">LRC</option>
                <option value="txt">TXT</option>
                <option value="ass">ASS</option>
                <option value="json">JSON</option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={subtitle.language?.downloadSpecified ?? false}
                onChange={(e) =>
                  patchSubtitle({
                    language: {
                      downloadSpecified: e.target.checked,
                      specifiedLanguages: subtitle.language?.specifiedLanguages ?? [],
                    },
                  })
                }
              />{" "}
              仅下载指定语言
            </label>
            <label>
              语言（逗号分隔 lan，如 zh,en,zh-Hant）
              <input
                value={langInput}
                placeholder="留空 = 下载全部语言"
                onChange={(e) => {
                  setLangInput(e.target.value);
                  const langs = e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter((s) => s.length > 0);
                  patchSubtitle({
                    language: {
                      downloadSpecified: subtitle.language?.downloadSpecified ?? false,
                      specifiedLanguages: langs,
                    },
                  });
                }}
                style={{ display: "block", marginTop: 4, width: 260 }}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={subtitle.embed ?? false}
                onChange={(e) => patchSubtitle({ embed: e.target.checked })}
              />{" "}
              内嵌进 MKV（仅 ASS + 输出 MKV 时生效）
            </label>
            <label>
              <input
                type="checkbox"
                disabled={(subtitle.embed ?? false) === false}
                checked={subtitle.deleteAfterEmbed ?? false}
                onChange={(e) => patchSubtitle({ deleteAfterEmbed: e.target.checked })}
              />{" "}
              内嵌成功后删除源文件
            </label>
          </div>
        </div>

        <div style={{ border: "1px solid #e5e5e5", borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <strong>封面</strong>
          <label style={{ display: "block", marginTop: 8 }}>
            <input
              type="checkbox"
              checked={cover.enabled ?? false}
              onChange={(e) => patchCover({ enabled: e.target.checked })}
            />{" "}
            下载封面
          </label>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
            <label>
              格式
              <select
                value={cover.format ?? "jpg"}
                onChange={(e) => patchCover({ format: e.target.value as CoverFormatDTO })}
                style={{ marginLeft: 6 }}
              >
                <option value="jpg">JPG</option>
                <option value="png">PNG</option>
                <option value="avif">AVIF</option>
                <option value="webp">WEBP</option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={cover.attach ?? false}
                onChange={(e) => patchCover({ attach: e.target.checked })}
              />{" "}
              附加进媒体文件（attach）
            </label>
            <label>
              <input
                type="checkbox"
                disabled={(cover.attach ?? false) === false}
                checked={cover.deleteAfterAttach ?? false}
                onChange={(e) => patchCover({ deleteAfterAttach: e.target.checked })}
              />{" "}
              attach 成功后删除源图片
            </label>
          </div>
        </div>

        <div style={{ border: "1px solid #e5e5e5", borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <strong>章节</strong>
          <label style={{ display: "block", marginTop: 8 }}>
            <input
              type="checkbox"
              checked={chapter.embed ?? false}
              onChange={(e) => patchChapter({ embed: e.target.checked })}
            />{" "}
            内嵌章节信息到媒体文件
          </label>
        </div>

        <div style={{ border: "1px solid #e5e5e5", borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <strong>元数据</strong>
          <label style={{ display: "block", marginTop: 8 }}>
            <input
              type="checkbox"
              checked={metadata.enabled ?? false}
              onChange={(e) => patchMetadata({ enabled: e.target.checked })}
            />{" "}
            下载元数据
          </label>
          <div style={{ marginTop: 6 }}>
            <label>
              格式
              <select
                value={metadata.format ?? "nfo"}
                onChange={(e) => patchMetadata({ format: e.target.value as MetadataFormatDTO })}
                style={{ marginLeft: 6 }}
              >
                <option value="nfo">NFO</option>
                <option value="json">JSON</option>
              </select>
            </label>
          </div>
        </div>
      </section>
    </div>
  );
}
