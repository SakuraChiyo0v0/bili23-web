export { BiliError } from "./errors.js";
export type { BiliErrorCode, BiliErrorOptions } from "./errors.js";
export { classifyUrl, URL_PATTERNS } from "./url.js";
export type { ContentType, UrlClassify } from "./url.js";
export {
  VIDEO_QUALITY,
  REVERSED_VIDEO_QUALITY,
  AUDIO_QUALITY,
  REVERSED_AUDIO_QUALITY,
  AUDIO_REORDER,
  AUDIO_CODEC,
  VIDEO_CODEC,
  VIDEO_CODEC_STR,
  REVERSED_VIDEO_CODEC,
  videoQualityLabel,
  audioQualityLabel,
} from "./constants/quality.js";
export type { VideoQualityKey, AudioQualityKey, VideoCodecKey } from "./constants/quality.js";
export { CookieJar } from "./api/cookies.js";
export { ensureAnonymousSession, buvidFpHex, makeUuid, makeBLsid } from "./api/session.js";
export { HttpClient } from "./api/http.js";
export type { HttpClientOptions, HttpRequestOptions, HttpMethod } from "./api/http.js";
export { getMixinKey, wbiSign, pyQuotePlus, MIXIN_KEY_ENC_TAB } from "./api/wbi.js";
export type { WbiParams } from "./api/wbi.js";
export type { MediaItem, ItemKind, ContainerType } from "./types.js";
export { parseUrl, getParser } from "./parser/index.js";
export { VideoParser, API_BASE as BILI_API_BASE } from "./parser/video.js";
export { SpaceParser, resetSpaceCache } from "./parser/space.js";
export { FavlistParser } from "./parser/favlist.js";
export { PopularParser } from "./parser/popular.js";
export { WatchLaterParser } from "./parser/watch-later.js";
export { HistoryParser } from "./parser/history.js";
export { AudioParser, AUDIO_API_BASE } from "./parser/audio.js";
export { LessonParser, LESSON_API_BASE, LESSON_DETAIL_URL } from "./parser/lesson.js";
export type { Parser, ParseContext, ParseOptions, ParseResult } from "./parser/types.js";
export { fetchVideoMediaInfo, normalizePlayPayload, assertPlayOk, isLoginApiError, dashStreamUrls } from "./media/video-info.js";
export { fetchAudioMediaInfo, fetchLessonMediaInfo } from "./media/flavor.js";
export { fetchPlayMediaInfo, flavorOf } from "./media/flavor.js";
export type { PlayFlavor } from "./media/flavor.js";
export type { VideoMediaInfo, VideoMediaType, StreamRef, PlayPayload } from "./media/video-info.js";
export { ensureWbiKeys, resetWbiKeyCache } from "./media/wbi-keys.js";
export type { WbiKeys } from "./media/wbi-keys.js";

export {
  AUTO_QUALITY,
  AUTO_CODEC,
  AUTO_AUDIO_QUALITY,
  DEFAULT_VIDEO_QUALITY_PRIORITY,
  DEFAULT_VIDEO_CODEC_PRIORITY,
  DEFAULT_AUDIO_QUALITY_PRIORITY,
  resolveStreams,
} from "./stream/resolver.js";
export type { StreamOptions, ResolvedStreams } from "./stream/resolver.js";

export {
  DownloadAbortedError,
  TokenBucket,
  downloadFile,
  probeStreamUrl,
  extractFileSize,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_FLUSH_INTERVAL,
  DEFAULT_MAX_CHUNK_RETRIES,
  DEFAULT_CONCURRENCY,
} from "./download/downloader.js";
export type {
  ChunkState,
  DownloadFileOptions,
  DownloadFileResult,
  DownloadProgress,
  ProbeOptions,
  ProbeResult,
} from "./download/downloader.js";
export { runDownloadPlan } from "./download/task.js";
export type {
  DownloadStatus,
  DownloadTaskFile,
  RunPlanOptions,
  RunPlanResult,
} from "./download/task.js";

export { runFfmpeg } from "./ffmpeg/runner.js";
export type { FfmpegRunOptions, FfmpegRunResult } from "./ffmpeg/runner.js";
export { buildMergeAudioVideo, buildRemux, buildConcatParts, buildMergeAudioVideoEx, buildConcatPartsEx } from "./ffmpeg/command.js";
export type { MergeExtras, SubtitleTrackSpec } from "./ffmpeg/command.js";
export { mergeAudioVideo, remuxMedia, concatMediaParts, probeMedia } from "./ffmpeg/merge.js";
export type { MergeOptions, MergeResult, ProbeInfo, ProbeStream } from "./ffmpeg/merge.js";

export { HASH_ID_VERSION, calcHashId, stableJson } from "./store/hash.js";
export type { HashIdentity } from "./store/hash.js";
export { TaskStore } from "./store/task-store.js";
export type { TaskRecord } from "./store/task-store.js";
export { HistoryService } from "./store/history.js";
export type { HistoryEntry } from "./store/history.js";
export {
  ConventionType,
  DEFAULT_NAMING_RULES,
  variablesFor,
  BASE_VARIABLES,
  ID_VARIABLES,
  TYPE_VARIABLES,
  DATETIME_VARIABLES,
} from "./naming/variables.js";
export type { NamingRule, NamingVariable, ConventionTypeId } from "./naming/variables.js";
export { formatFileName, normalizePath, sanitizeComponent, strftime, validateRule } from "./naming/formatter.js";
export { buildNamingVariables, resolveConventionType } from "./naming/context.js";
export type { NamingVariables, NamingQuality } from "./naming/context.js";
export { NumberingAllocator, NumberingType, allocNumber } from "./naming/numbering.js";
export type { NumberingTypeId } from "./naming/numbering.js";

// ---------- 附加内容（extras）----------
export type {
  DanmakuFormat,
  SubtitleFormat,
  CoverFormat,
  MetadataFormat,
  DanmakuStyle,
  SubtitleStyle,
  SubtitleLanguageSelection,
  DanmakuOptions,
  SubtitleOptions,
  CoverOptions,
  ChapterOptions,
  MetadataOptions,
  ExtrasOptions,
  ExtrasContext,
  ExtrasTarget,
  DanmakuEntry,
  SubtitleInfo,
  SubtitleJson,
  PlayerInfo,
  MetadataInput,
  NfoOutput,
} from "./extras/types.js";
export {
  DEFAULT_DANMAKU_STYLE,
  DEFAULT_SUBTITLE_STYLE,
  DEFAULT_SUBTITLE_LANGUAGE,
  DEFAULT_EXTRAS_OPTIONS,
  EXTRA_QUALIFIER,
} from "./extras/types.js";
export {
  fetchDanmakuXml,
  fetchPlayerInfo,
  fetchSubtitleJson,
  fetchCoverBytes,
  fetchVideoTags,
  fetchSubtitlesData,
  filterSubtitleInfos,
  coverDownloadUrl,
  resolveSubtitleUrl,
} from "./extras/fetch.js";
export type { SubtitleDataEntry } from "./extras/fetch.js";
export { parseDanmakuXml, renderDanmakuXml, danmakuToXml, escapeXmlText } from "./extras/danmaku-xml.js";
export { danmakuToAss, measureTextWidth, buildDanmakuStyleLine } from "./extras/danmaku-ass.js";
export { danmakuToJson } from "./extras/danmaku-json.js";
export { toSubtitleSrt } from "./extras/subtitle-srt.js";
export { toSubtitleLrc } from "./extras/subtitle-lrc.js";
export { toSubtitleTxt } from "./extras/subtitle-txt.js";
export { toSubtitleAss, toIso639_2, subtitleTrackTitle, buildSubtitleStyleLine } from "./extras/subtitle-ass.js";
export { toSubtitleJson } from "./extras/subtitle-json.js";
export { buildMetadataNfo } from "./extras/metadata-nfo.js";
export { buildMetadataJson } from "./extras/metadata-json.js";
export { buildChapterFfmetadata, chapterFileName, escapeFfmetadataValue } from "./extras/chapter.js";
export type { ViewPoint } from "./extras/chapter.js";
export {
  coverFileName,
  buildCoverConvertArgs,
  buildAttachCoverToMedia,
} from "./extras/cover.js";
export {
  formatSrtTime,
  formatAssTimeByMs,
  formatAssTimeBySeconds,
  formatDateYmd,
} from "./extras/time.js";
