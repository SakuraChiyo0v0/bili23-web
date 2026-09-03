import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type {
  AdvancedConfigDTO,
  AppConfigDTO,
  BehaviorConfigDTO,
  ChapterOptionsDTO,
  CoverFormatDTO,
  CoverOptionsDTO,
  DanmakuFormatDTO,
  DanmakuOptionsDTO,
  DownloadConfigDTO,
  ExtrasOptionsDTO,
  MetadataFormatDTO,
  MetadataOptionsDTO,
  NamingRuleDTO,
  SubtitleFormatDTO,
  SubtitleOptionsDTO,
} from "./types.js";
import { useI18n } from "./i18n.js";
import type { I18nKey } from "./i18n.js";
import { useTheme } from "./theme.js";

/** 命名模板变量提示；文案由 i18n 字典按 hintKey 提供（点击可插入输入框） */
interface VarToken {
  token: string;
  hintKey: string;
}

type GroupName = "behavior" | "download" | "additional" | "naming" | "advanced";
type Notice = { group: GroupName; kind: "ok" | "err"; text: string };

const SECTIONS: GroupName[] = ["behavior", "download", "additional", "naming", "advanced"];

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const json = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok || (json as { error?: unknown }).error) {
    throw new Error(json.error?.message ?? `HTTP ${res.status}`);
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
    throw new Error(json.error?.message ?? `HTTP ${res.status}`);
  }
  return json;
}

/** 数值字符串 → 限幅整数 */
function clampInt(text: string, min: number, max: number, fallback: number): number {
  const n = Math.floor(Number(text));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function optionalInt(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  const n = Math.floor(Number(trimmed));
  return Number.isFinite(n) ? n : undefined;
}

export function SettingsView() {
  const { t } = useI18n();
  const { setPref: setThemePref } = useTheme();
  const { setPref: setLangPref } = useI18n();
  const [cfg, setCfg] = useState<AppConfigDTO | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [section, setSection] = useState<GroupName>("behavior");
  const [saving, setSaving] = useState<GroupName | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  // 文件命名
  const [startText, setStartText] = useState("1");
  const ruleRefs = useRef<Record<string, HTMLInputElement | null>>({});
  // 附加内容-字幕语言
  const [langInput, setLangInput] = useState("");
  // 下载组文本输入
  const [dirText, setDirText] = useState("");
  const [parallelText, setParallelText] = useState("2");
  const [threadsText, setThreadsText] = useState("4");
  const [speedText, setSpeedText] = useState("0");
  // 高级组文本输入
  const [vqText, setVqText] = useState("");
  const [aqText, setAqText] = useState("");
  const [codecText, setCodecText] = useState("");
  const [cdnText, setCdnText] = useState("");
  const [ffmpegText, setFfmpegText] = useState("");
  const [proxyText, setProxyText] = useState("");

  const syncTextStates = useCallback((config: AppConfigDTO): void => {
    setStartText(String(config.fileNaming?.startingNumber ?? 1));
    setLangInput(config.additional?.subtitle?.language?.specifiedLanguages?.join(",") ?? "");
    setDirText(config.download?.dir ?? "");
    setParallelText(String(config.download?.parallel ?? 2));
    setThreadsText(String(config.download?.threads ?? 4));
    setSpeedText(String(config.download?.speedLimitKbps ?? 0));
    setVqText(config.advanced?.defaultVideoQualityId !== undefined ? String(config.advanced.defaultVideoQualityId) : "");
    setAqText(config.advanced?.defaultAudioQualityId !== undefined ? String(config.advanced.defaultAudioQualityId) : "");
    setCodecText(config.advanced?.defaultCodecId !== undefined ? String(config.advanced.defaultCodecId) : "");
    setCdnText((config.advanced?.cdnHosts ?? []).join(", "));
    setFfmpegText(config.advanced?.ffmpegPath ?? "");
    setProxyText(config.advanced?.proxy ?? "");
  }, []);

  const load = useCallback(async () => {
    setLoadErr("");
    setNotice(null);
    try {
      const { config } = await getJson<{ config: AppConfigDTO }>("/api/config");
      setCfg(config);
      syncTextStates(config);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
    }
  }, [syncTextStates]);

  useEffect(() => {
    void load();
  }, [load]);

  // ---------- 局部补丁 ----------

  const patchBehavior = useCallback((patch: Partial<BehaviorConfigDTO>): void => {
    setCfg((prev) => {
      if (!prev) return prev;
      const base: BehaviorConfigDTO = prev.behavior ?? { language: "system", theme: "system" };
      return { ...prev, behavior: { ...base, ...patch } };
    });
  }, []);

  const patchDownload = useCallback((patch: Partial<DownloadConfigDTO>): void => {
    setCfg((prev) => {
      if (!prev) return prev;
      const base: DownloadConfigDTO = prev.download ?? {
        parallel: 2,
        threads: 4,
        speedLimitKbps: 0,
        renamePolicy: "auto",
        duplicatePolicy: "prompt",
        defaultContainer: "mp4",
      };
      return { ...prev, download: { ...base, ...patch } };
    });
  }, []);

  const patchAdvanced = useCallback((patch: Partial<AdvancedConfigDTO>): void => {
    setCfg((prev) => {
      if (!prev) return prev;
      const base: AdvancedConfigDTO = prev.advanced ?? { cdnHosts: [] };
      return { ...prev, advanced: { ...base, ...patch } };
    });
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

  const insertVar = useCallback(
    (ruleId: string, token: string): void => {
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
    },
    [updateRule],
  );

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

  // ---------- 保存 ----------

  /** 服务端返回的完整 config：仅把“本次保存的分组”回写本地，避免覆盖其他组未保存的编辑 */
  const applySavedGroup = useCallback((group: GroupName, server: AppConfigDTO): void => {
    setCfg((prev) => {
      if (!prev) return prev;
      switch (group) {
        case "behavior":
          return server.behavior !== undefined ? { ...prev, behavior: server.behavior } : prev;
        case "download":
          return server.download !== undefined ? { ...prev, download: server.download } : prev;
        case "additional":
          return server.additional !== undefined ? { ...prev, additional: server.additional } : prev;
        case "naming":
          return server.fileNaming !== undefined ? { ...prev, fileNaming: server.fileNaming } : prev;
        case "advanced":
          return server.advanced !== undefined ? { ...prev, advanced: server.advanced } : prev;
      }
    });
  }, []);

  const finishSave = useCallback(
    (group: GroupName, server: AppConfigDTO, syncText: boolean): void => {
      applySavedGroup(group, server);
      if (syncText) syncTextStates(server);
      setNotice({ group, kind: "ok", text: t("settings.saved") });
    },
    [applySavedGroup, syncTextStates, t],
  );

  const saveBehavior = useCallback(async () => {
    if (!cfg) return;
    setSaving("behavior");
    setNotice(null);
    try {
      const behavior = cfg.behavior ?? { language: "system", theme: "system" };
      const { config } = await putJson<{ config: AppConfigDTO }>("/api/config", {
        config: { behavior },
      });
      const saved = config.behavior ?? behavior;
      setThemePref(saved.theme ?? "system");
      setLangPref(saved.language ?? "system");
      finishSave("behavior", config, false);
    } catch (e) {
      setNotice({ group: "behavior", kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(null);
    }
  }, [cfg, finishSave, setThemePref, setLangPref]);

  const saveDownload = useCallback(async () => {
    if (!cfg) return;
    setSaving("download");
    setNotice(null);
    try {
      const download: DownloadConfigDTO = {
        parallel: clampInt(parallelText, 1, 16, 2),
        threads: clampInt(threadsText, 1, 16, 4),
        speedLimitKbps: Math.max(0, Math.floor(Number(speedText) || 0)),
        renamePolicy: cfg.download?.renamePolicy ?? "auto",
        duplicatePolicy: cfg.download?.duplicatePolicy ?? "prompt",
        defaultContainer: cfg.download?.defaultContainer ?? "mp4",
      };
      const dir = dirText.trim();
      if (dir) download.dir = dir;
      const { config } = await putJson<{ config: AppConfigDTO }>("/api/config", {
        config: { download },
      });
      finishSave("download", config, true);
    } catch (e) {
      setNotice({ group: "download", kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(null);
    }
  }, [cfg, parallelText, threadsText, speedText, dirText, finishSave]);

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
      finishSave("naming", config, true);
    } catch (e) {
      setNotice({ group: "naming", kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(null);
    }
  }, [cfg, startText, finishSave]);

  const saveAdditional = useCallback(async () => {
    if (!cfg?.additional) return;
    setSaving("additional");
    setNotice(null);
    try {
      const { config } = await putJson<{ config: AppConfigDTO }>("/api/config", {
        config: { additional: cfg.additional },
      });
      finishSave("additional", config, true);
    } catch (e) {
      setNotice({ group: "additional", kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(null);
    }
  }, [cfg, finishSave]);

  const saveAdvanced = useCallback(async () => {
    if (!cfg) return;
    setSaving("advanced");
    setNotice(null);
    try {
      const advanced: AdvancedConfigDTO = {
        cdnHosts: cdnText
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
      };
      const vq = optionalInt(vqText);
      if (vq !== undefined) advanced.defaultVideoQualityId = vq;
      const aq = optionalInt(aqText);
      if (aq !== undefined) advanced.defaultAudioQualityId = aq;
      const codec = optionalInt(codecText);
      if (codec !== undefined) advanced.defaultCodecId = codec;
      const ff = ffmpegText.trim();
      if (ff) advanced.ffmpegPath = ff;
      const px = proxyText.trim();
      if (px) advanced.proxy = px;
      const { config } = await putJson<{ config: AppConfigDTO }>("/api/config", {
        config: { advanced },
      });
      finishSave("advanced", config, true);
    } catch (e) {
      setNotice({ group: "advanced", kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(null);
    }
  }, [cfg, cdnText, vqText, aqText, codecText, ffmpegText, proxyText, finishSave]);

  if (loadErr && !cfg) {
    return (
      <div>
        <h2>{t("settings.title")}</h2>
        <p style={{ color: "var(--danger)" }}>{t("settings.loadFailed", { err: loadErr })}</p>
        <button onClick={() => void load()}>{t("common.retry")}</button>
      </div>
    );
  }

  if (!cfg) {
    return (
      <div>
        <h2>{t("settings.title")}</h2>
        <p style={{ color: "var(--text-3)" }}>{t("settings.loading")}</p>
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
  const dl = cfg.download ?? {
    parallel: 2,
    threads: 4,
    speedLimitKbps: 0,
    renamePolicy: "auto" as const,
    duplicatePolicy: "prompt" as const,
    defaultContainer: "mp4" as const,
  };
  const behavior = cfg.behavior ?? { language: "system" as const, theme: "system" as const };
  const noticeFor = (g: GroupName): Notice | null => (notice && notice.group === g ? notice : null);

  const sectionTitleKey: Record<GroupName, string> = {
    behavior: "settings.behavior.title",
    download: "settings.download.title",
    additional: "settings.additional.title",
    naming: "settings.naming.title",
    advanced: "settings.advanced.title",
  };

  return (
    <div>
      <h2 style={{ margin: 0 }}>{t("settings.title")}</h2>

      {/* 分组导航 */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "12px 0" }}>
        {SECTIONS.map((g) => (
          <button
            key={g}
            onClick={() => setSection(g)}
            style={{
              padding: "5px 12px",
              borderRadius: 14,
              border: "1px solid var(--border)",
              background: section === g ? "var(--accent-soft)" : "var(--surface)",
              color: section === g ? "var(--accent)" : "var(--text-2)",
              cursor: "pointer",
            }}
          >
            {t(`settings.sections.${g}`)}
          </button>
        ))}
      </div>

      {section === "behavior" && (
        <section
          style={{
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: 14,
            background: "var(--surface)",
            maxWidth: 640,
          }}
        >
          <h3 style={{ marginTop: 0 }}>{t("settings.behavior.title")}</h3>
          <p style={{ color: "var(--text-2)", fontSize: 13 }}>{t("settings.behavior.hint")}</p>
          {noticeFor("behavior") && <NoticeLine notice={noticeFor("behavior")} />}
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", margin: "10px 0" }}>
            <label>
              {t("settings.behavior.language")}
              <select
                value={behavior.language}
                onChange={(e) => patchBehavior({ language: e.target.value as BehaviorConfigDTO["language"] })}
                style={{ display: "block", marginTop: 4, minWidth: 170 }}
              >
                <option value="system">{t("settings.behavior.option.system")}</option>
                <option value="zh-CN">{t("settings.behavior.language.zh-CN")}</option>
                <option value="zh-TW">{t("settings.behavior.language.zh-TW")}</option>
                <option value="en">{t("settings.behavior.language.en")}</option>
              </select>
            </label>
            <label>
              {t("settings.behavior.theme")}
              <select
                value={behavior.theme}
                onChange={(e) => patchBehavior({ theme: e.target.value as BehaviorConfigDTO["theme"] })}
                style={{ display: "block", marginTop: 4, minWidth: 170 }}
              >
                <option value="system">{t("settings.behavior.option.system")}</option>
                <option value="light">{t("settings.behavior.theme.light")}</option>
                <option value="dark">{t("settings.behavior.theme.dark")}</option>
              </select>
            </label>
          </div>
          <div>
            <button disabled={saving !== null} onClick={() => void saveBehavior()}>
              {saving === "behavior" ? t("common.saving") : t("common.save")}
            </button>
          </div>
        </section>
      )}

      {section === "download" && (
        <section
          style={{
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: 14,
            background: "var(--surface)",
            maxWidth: 640,
          }}
        >
          <h3 style={{ marginTop: 0 }}>{t("settings.download.title")}</h3>
          <p style={{ color: "var(--text-2)", fontSize: 13 }}>{t("settings.download.hint")}</p>
          {noticeFor("download") && <NoticeLine notice={noticeFor("download")} />}
          <div style={{ display: "flex", flexDirection: "column", gap: 10, margin: "10px 0" }}>
            <label>
              {t("settings.download.dir")}
              <input
                value={dirText}
                placeholder={t("settings.download.dirPlaceholder")}
                onChange={(e) => setDirText(e.target.value)}
                style={{ display: "block", marginTop: 4, width: "100%", boxSizing: "border-box" }}
              />
            </label>
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
              <label>
                {t("settings.download.parallel")}
                <input
                  type="number"
                  min={1}
                  max={16}
                  step={1}
                  value={parallelText}
                  onChange={(e) => setParallelText(e.target.value)}
                  style={{ display: "block", marginTop: 4, width: 120 }}
                />
              </label>
              <label>
                {t("settings.download.threads")}
                <input
                  type="number"
                  min={1}
                  max={16}
                  step={1}
                  value={threadsText}
                  onChange={(e) => setThreadsText(e.target.value)}
                  style={{ display: "block", marginTop: 4, width: 120 }}
                />
              </label>
              <label>
                {t("settings.download.speed")}
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={speedText}
                  onChange={(e) => setSpeedText(e.target.value)}
                  style={{ display: "block", marginTop: 4, width: 140 }}
                />
              </label>
            </div>
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
              <label>
                {t("settings.download.renamePolicy")}
                <select
                  value={dl.renamePolicy}
                  onChange={(e) =>
                    patchDownload({ renamePolicy: e.target.value as DownloadConfigDTO["renamePolicy"] })
                  }
                  style={{ display: "block", marginTop: 4 }}
                >
                  <option value="auto">{t("settings.download.renamePolicy.auto")}</option>
                  <option value="overwrite">{t("settings.download.renamePolicy.overwrite")}</option>
                </select>
              </label>
              <label>
                {t("settings.download.duplicatePolicy")}
                <select
                  value={dl.duplicatePolicy}
                  onChange={(e) =>
                    patchDownload({ duplicatePolicy: e.target.value as DownloadConfigDTO["duplicatePolicy"] })
                  }
                  style={{ display: "block", marginTop: 4 }}
                >
                  <option value="prompt">{t("settings.download.duplicatePolicy.prompt")}</option>
                  <option value="skip">{t("settings.download.duplicatePolicy.skip")}</option>
                  <option value="force">{t("settings.download.duplicatePolicy.force")}</option>
                </select>
              </label>
              <label>
                {t("settings.download.defaultContainer")}
                <select
                  value={dl.defaultContainer}
                  onChange={(e) =>
                    patchDownload({
                      defaultContainer: e.target.value as DownloadConfigDTO["defaultContainer"],
                    })
                  }
                  style={{ display: "block", marginTop: 4 }}
                >
                  <option value="mp4">MP4</option>
                  <option value="mkv">MKV</option>
                </select>
              </label>
            </div>
          </div>
          <div>
            <button disabled={saving !== null} onClick={() => void saveDownload()}>
              {saving === "download" ? t("common.saving") : t("common.save")}
            </button>
          </div>
        </section>
      )}
      {section === "additional" && (
        <section style={{ maxWidth: 800 }}>
          <h3>{t("settings.additional.title")}</h3>
          <p style={{ color: "var(--text-2)", fontSize: 13 }}>{t("settings.additional.hint")}</p>
          {noticeFor("additional") && <NoticeLine notice={noticeFor("additional")} />}
          <div style={{ margin: "10px 0" }}>
            <button disabled={saving !== null} onClick={() => void saveAdditional()}>
              {saving === "additional" ? t("common.saving") : t("common.save")}
            </button>
          </div>

          <Card title={t("settings.additional.danmaku")}>
            <label style={{ display: "block", marginTop: 8 }}>
              <input
                type="checkbox"
                checked={danmaku.enabled ?? false}
                onChange={(e) => patchDanmaku({ enabled: e.target.checked })}
              />{" "}
              {t("settings.additional.downloadDanmaku")}
            </label>
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
              <label>
                {t("settings.additional.format")}
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
                {t("settings.additional.embedMkv")}
              </label>
              <label>
                <input
                  type="checkbox"
                  disabled={(danmaku.embed ?? false) === false}
                  checked={danmaku.deleteAfterEmbed ?? false}
                  onChange={(e) => patchDanmaku({ deleteAfterEmbed: e.target.checked })}
                />{" "}
                {t("settings.additional.deleteAfterEmbed")}
              </label>
            </div>
          </Card>

          <Card title={t("settings.additional.subtitle")}>
            <label style={{ display: "block", marginTop: 8 }}>
              <input
                type="checkbox"
                checked={subtitle.enabled ?? false}
                onChange={(e) => patchSubtitle({ enabled: e.target.checked })}
              />{" "}
              {t("settings.additional.downloadSubtitle")}
            </label>
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
              <label>
                {t("settings.additional.format")}
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
                {t("settings.additional.onlySpecified")}
              </label>
              <label>
                {t("settings.additional.languages")}
                <input
                  value={langInput}
                  placeholder={t("settings.additional.languagesPlaceholder")}
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
                {t("settings.additional.embedMkv")}
              </label>
              <label>
                <input
                  type="checkbox"
                  disabled={(subtitle.embed ?? false) === false}
                  checked={subtitle.deleteAfterEmbed ?? false}
                  onChange={(e) => patchSubtitle({ deleteAfterEmbed: e.target.checked })}
                />{" "}
                {t("settings.additional.deleteAfterEmbed")}
              </label>
            </div>
          </Card>

          <Card title={t("settings.additional.cover")}>
            <label style={{ display: "block", marginTop: 8 }}>
              <input
                type="checkbox"
                checked={cover.enabled ?? false}
                onChange={(e) => patchCover({ enabled: e.target.checked })}
              />{" "}
              {t("settings.additional.downloadCover")}
            </label>
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
              <label>
                {t("settings.additional.format")}
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
                {t("settings.additional.attach")}
              </label>
              <label>
                <input
                  type="checkbox"
                  disabled={(cover.attach ?? false) === false}
                  checked={cover.deleteAfterAttach ?? false}
                  onChange={(e) => patchCover({ deleteAfterAttach: e.target.checked })}
                />{" "}
                {t("settings.additional.deleteAfterAttach")}
              </label>
            </div>
          </Card>

          <Card title={t("settings.additional.chapter")}>
            <label style={{ display: "block", marginTop: 8 }}>
              <input
                type="checkbox"
                checked={chapter.embed ?? false}
                onChange={(e) => patchChapter({ embed: e.target.checked })}
              />{" "}
              {t("settings.additional.embedChapter")}
            </label>
          </Card>

          <Card title={t("settings.additional.metadata")}>
            <label style={{ display: "block", marginTop: 8 }}>
              <input
                type="checkbox"
                checked={metadata.enabled ?? false}
                onChange={(e) => patchMetadata({ enabled: e.target.checked })}
              />{" "}
              {t("settings.additional.downloadMetadata")}
            </label>
            <div style={{ marginTop: 6 }}>
              <label>
                {t("settings.additional.format")}
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
          </Card>
        </section>
      )}

      {section === "naming" && (
        <section style={{ maxWidth: 900 }}>
          <h3>{t("settings.naming.title")}</h3>
          <p style={{ color: "var(--text-2)", fontSize: 13 }}>{t("settings.naming.hint")}</p>
          {noticeFor("naming") && <NoticeLine notice={noticeFor("naming")} />}
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "end", margin: "10px 0" }}>
            <label>
              {t("settings.naming.numberingMode")}
              <select
                value={numberingType}
                onChange={(e) => setNumberingType(Number(e.target.value))}
                style={{ display: "block", marginTop: 4 }}
              >
                <option value={2}>{t("settings.naming.numbering.2")}</option>
                <option value={0}>{t("settings.naming.numbering.0")}</option>
                <option value={1}>{t("settings.naming.numbering.1")}</option>
              </select>
            </label>
            <label>
              {t("settings.naming.startNumber")}
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
            <span style={{ color: "var(--text-3)", fontSize: 12, maxWidth: 340 }}>
              {useParseList
                ? t("settings.naming.modeHint.parseList")
                : t("settings.naming.modeHint.numbered")}
            </span>
          </div>
          <div style={{ marginBottom: 8 }}>
            <button disabled={saving !== null} onClick={() => void saveNaming()}>
              {saving === "naming" ? t("common.saving") : t("common.save")}
            </button>
          </div>
          {rules.map((rule: NamingRuleDTO) => {
            const labelKey = `settings.typeLabel.${rule.type}` as I18nKey;
            const raw = t(labelKey);
            const label = raw === labelKey ? t("settings.typeUnknown", { type: rule.type }) : raw;
            const tokens = TYPE_TOKENS[rule.type] ?? [];
            return (
              <div
                key={rule.id}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: 10,
                  marginBottom: 10,
                  background: "var(--surface)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
                  <strong style={{ minWidth: 64 }}>{label}</strong>
                  <span style={{ color: "var(--text-3)", fontSize: 12 }}>{rule.name}</span>
                </div>
                <input
                  ref={(el) => {
                    ruleRefs.current[rule.id] = el;
                  }}
                  value={rule.rule}
                  onChange={(e) => updateRule(rule.id, e.target.value)}
                  placeholder={t("settings.naming.rulePlaceholder")}
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "6px 8px",
                    fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
                  }}
                />
                <div style={{ marginTop: 6, fontSize: 12 }}>
                  <span style={{ color: "var(--text-2)" }}>{t("settings.naming.availableVars")}</span>
                  {tokens.length === 0 && (
                    <span style={{ color: "var(--text-3)" }}>{t("settings.naming.noVars")}</span>
                  )}
                  {tokens.map((tk) => (
                    <button
                      key={tk.token}
                      type="button"
                      title={t(tk.hintKey as I18nKey)}
                      onClick={() => insertVar(rule.id, tk.token)}
                      style={{
                        margin: "2px 4px 2px 0",
                        padding: "1px 6px",
                        fontSize: 12,
                        borderRadius: 10,
                        border: "1px dashed var(--border-strong)",
                        background: "var(--surface-2)",
                        cursor: "pointer",
                        color: "var(--accent)",
                        fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
                      }}
                    >
                      {tk.token}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {section === "advanced" && (
        <section
          style={{
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: 14,
            background: "var(--surface)",
            maxWidth: 640,
          }}
        >
          <h3 style={{ marginTop: 0 }}>{t("settings.advanced.title")}</h3>
          <p style={{ color: "var(--text-2)", fontSize: 13 }}>{t("settings.advanced.note")}</p>
          {noticeFor("advanced") && <NoticeLine notice={noticeFor("advanced")} />}
          <div style={{ display: "flex", flexDirection: "column", gap: 10, margin: "10px 0" }}>
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
              <label>
                {t("settings.advanced.videoQualityId")}
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={vqText}
                  onChange={(e) => setVqText(e.target.value)}
                  style={{ display: "block", marginTop: 4, width: 130 }}
                />
              </label>
              <label>
                {t("settings.advanced.audioQualityId")}
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={aqText}
                  onChange={(e) => setAqText(e.target.value)}
                  style={{ display: "block", marginTop: 4, width: 130 }}
                />
              </label>
              <label>
                {t("settings.advanced.codecId")}
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={codecText}
                  onChange={(e) => setCodecText(e.target.value)}
                  style={{ display: "block", marginTop: 4, width: 130 }}
                />
              </label>
            </div>
            <label>
              {t("settings.advanced.cdnHosts")}
              <input
                value={cdnText}
                placeholder="https://upos-sz-mirrorcos.bilivideo.com, https://..."
                onChange={(e) => setCdnText(e.target.value)}
                style={{ display: "block", marginTop: 4, width: "100%", boxSizing: "border-box" }}
              />
            </label>
            <label>
              {t("settings.advanced.ffmpegPath")}
              <input
                value={ffmpegText}
                placeholder="/usr/bin/ffmpeg"
                onChange={(e) => setFfmpegText(e.target.value)}
                style={{ display: "block", marginTop: 4, width: "100%", boxSizing: "border-box" }}
              />
            </label>
            <label>
              {t("settings.advanced.proxy")}
              <input
                value={proxyText}
                placeholder="http://127.0.0.1:7890"
                onChange={(e) => setProxyText(e.target.value)}
                style={{ display: "block", marginTop: 4, width: "100%", boxSizing: "border-box" }}
              />
            </label>
          </div>
          <div>
            <button disabled={saving !== null} onClick={() => void saveAdvanced()}>
              {saving === "advanced" ? t("common.saving") : t("common.save")}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function NoticeLine({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  return (
    <p style={{ color: notice.kind === "ok" ? "var(--success)" : "var(--danger)", margin: "8px 0 0" }}>
      {notice.text}
    </p>
  );
}

function Card(props: { title: string; children: ReactNode }) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: 12,
        marginBottom: 12,
        background: "var(--surface)",
      }}
    >
      <strong>{props.title}</strong>
      {props.children}
    </div>
  );
}
// ---------- 命名变量提示目录（hintKey 由 i18n 字典提供翻译） ----------

const COMMON_TOKENS: VarToken[] = [
  { token: "{number}", hintKey: "hint.number" },
  { token: "{uploader}", hintKey: "hint.uploader" },
  { token: "{uploader_uid}", hintKey: "hint.uploaderUid" },
  { token: "{pub_time:%Y-%m-%d}", hintKey: "hint.pubTime" },
  { token: "{create_time:%Y-%m-%d}", hintKey: "hint.createTime" },
  { token: "{video_quality}", hintKey: "hint.videoQuality" },
  { token: "{audio_quality}", hintKey: "hint.audioQuality" },
  { token: "{video_codec}", hintKey: "hint.videoCodec" },
];

const ID_TOKENS: VarToken[] = [
  { token: "{aid}", hintKey: "hint.aid" },
  { token: "{bvid}", hintKey: "hint.bvid" },
  { token: "{cid}", hintKey: "hint.cid" },
];

const TYPE_TOKENS: Record<number, VarToken[]> = {
  11: [{ token: "{leaf_title}", hintKey: "hint.leafTitle" }, ...COMMON_TOKENS, ...ID_TOKENS],
  12: [
    { token: "{parent_title}", hintKey: "hint.parentTitle" },
    { token: "{p}", hintKey: "hint.p" },
    { token: "{leaf_title}", hintKey: "hint.partTitle" },
    ...COMMON_TOKENS,
    ...ID_TOKENS,
  ],
  13: [
    { token: "{collection_title}", hintKey: "hint.collectionTitle" },
    { token: "{section_title}", hintKey: "hint.sectionTitle" },
    { token: "{parent_title}", hintKey: "hint.videoTitle" },
    { token: "{leaf_title}", hintKey: "hint.partTitle" },
    { token: "{p}", hintKey: "hint.p" },
    ...COMMON_TOKENS,
    ...ID_TOKENS,
  ],
  14: [
    { token: "{parent_title}", hintKey: "hint.interactiveTitle" },
    { token: "{leaf_title}", hintKey: "hint.nodeTitle" },
    ...COMMON_TOKENS,
    ...ID_TOKENS,
  ],
  20: [
    { token: "{season_title}", hintKey: "hint.seasonTitle" },
    { token: "{series_title}", hintKey: "hint.seriesTitle" },
    { token: "{section_title}", hintKey: "hint.episodeSectionTitle" },
    { token: "{episode_title}", hintKey: "hint.episodeTitle" },
    { token: "{episode_number}", hintKey: "hint.episodeNumber" },
    { token: "{season_number}", hintKey: "hint.seasonNumber" },
    { token: "{ep_id}", hintKey: "hint.epId" },
    { token: "{season_id}", hintKey: "hint.seasonId" },
    ...COMMON_TOKENS,
  ],
  30: [
    { token: "{series_title}", hintKey: "hint.courseTitle" },
    { token: "{section_title}", hintKey: "hint.sectionTitle" },
    { token: "{episode_title}", hintKey: "hint.lessonTitle" },
    { token: "{ep_id}", hintKey: "hint.lessonEpId" },
    { token: "{season_id}", hintKey: "hint.courseSeasonId" },
    ...COMMON_TOKENS,
  ],
  31: [
    { token: "{series_title}", hintKey: "hint.courseTitle" },
    { token: "{section_title}", hintKey: "hint.sectionTitle" },
    { token: "{episode_title}", hintKey: "hint.lessonTitle" },
    { token: "{course_id}", hintKey: "hint.courseId" },
    { token: "{lesson_id}", hintKey: "hint.lessonId" },
    { token: "{section_id}", hintKey: "hint.sectionId" },
    { token: "{item_id}", hintKey: "hint.itemId" },
    ...COMMON_TOKENS,
  ],
  40: [
    { token: "{favorites_name}", hintKey: "hint.favoritesName" },
    { token: "{favorites_owner}", hintKey: "hint.favoritesOwner" },
    { token: "{favorites_owner_id}", hintKey: "hint.favoritesOwnerId" },
    { token: "{favorites_id}", hintKey: "hint.favoritesId" },
    { token: "{parent_title}", hintKey: "hint.videoTitle" },
    { token: "{leaf_title}", hintKey: "hint.partTitle" },
    { token: "{fav_time:%Y-%m-%d}", hintKey: "hint.favTime" },
    ...COMMON_TOKENS,
  ],
  50: [
    { token: "{space_owner}", hintKey: "hint.spaceOwner" },
    { token: "{space_owner_id}", hintKey: "hint.spaceOwnerId" },
    { token: "{parent_title}", hintKey: "hint.videoTitle" },
    { token: "{leaf_title}", hintKey: "hint.partTitle" },
    ...COMMON_TOKENS,
  ],
  60: [
    { token: "{parent_title}", hintKey: "hint.historyParentTitle" },
    { token: "{leaf_title}", hintKey: "hint.videoTitle" },
    { token: "{last_watched_time:%Y-%m-%d}", hintKey: "hint.lastWatchedTime" },
    ...COMMON_TOKENS,
  ],
  70: [
    { token: "{parent_title}", hintKey: "hint.watchLaterParentTitle" },
    { token: "{leaf_title}", hintKey: "hint.videoTitle" },
    { token: "{fav_time:%Y-%m-%d}", hintKey: "hint.favTime" },
    ...COMMON_TOKENS,
  ],
  80: [
    { token: "{parent_title}", hintKey: "hint.weeklyParentTitle" },
    { token: "{leaf_title}", hintKey: "hint.videoTitle" },
    ...COMMON_TOKENS,
  ],
  90: [
    { token: "{leaf_title}", hintKey: "hint.songTitle" },
    { token: "{parent_title}", hintKey: "hint.playlistTitle" },
    { token: "{uploader}", hintKey: "hint.artist" },
    { token: "{pub_time:%Y-%m-%d}", hintKey: "hint.pubTime" },
    { token: "{number}", hintKey: "hint.number" },
    { token: "{audio_quality}", hintKey: "hint.audioQuality" },
  ],
};