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
export { HttpClient } from "./api/http.js";
export type { HttpClientOptions, HttpRequestOptions, HttpMethod } from "./api/http.js";
export { getMixinKey, wbiSign, pyQuotePlus, MIXIN_KEY_ENC_TAB } from "./api/wbi.js";
export type { WbiParams } from "./api/wbi.js";
export type { MediaItem } from "./types.js";
export { parseUrl, getParser } from "./parser/index.js";
export { VideoParser, API_BASE as BILI_API_BASE } from "./parser/video.js";
export type { Parser, ParseContext, ParseOptions, ParseResult } from "./parser/types.js";
export { fetchVideoMediaInfo } from "./media/video-info.js";
export type { VideoMediaInfo, VideoMediaType, StreamRef } from "./media/video-info.js";
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
export { buildMergeAudioVideo, buildRemux, buildConcatParts } from "./ffmpeg/command.js";
export { mergeAudioVideo, remuxMedia, concatMediaParts, probeMedia } from "./ffmpeg/merge.js";
export type { MergeOptions, MergeResult, ProbeInfo, ProbeStream } from "./ffmpeg/merge.js";

export { HASH_ID_VERSION, calcHashId, stableJson } from "./store/hash.js";
export type { HashIdentity } from "./store/hash.js";
export { TaskStore } from "./store/task-store.js";
export type { TaskRecord } from "./store/task-store.js";
export { HistoryService } from "./store/history.js";
export type { HistoryEntry } from "./store/history.js";
