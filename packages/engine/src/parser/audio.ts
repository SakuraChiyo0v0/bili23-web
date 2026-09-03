import { BiliError } from "../errors.js";
import { classifyUrl } from "../url.js";
import type { MediaItem } from "../types.js";
import type { ParseContext, ParseOptions, ParseResult, Parser } from "./types.js";

/** 音频（音乐区）接口基址：单曲信息 / 歌单信息 / 歌单歌曲列表共用 */
export const AUDIO_API_BASE = "https://www.bilibili.com/audio/music-service-c/web";

/** 歌曲条目（song/info 单曲与 of-menu 列表共用同一字段形状） */
interface AudioSong {
  id?: number;
  uid?: number;
  uname?: string;
  author?: string;
  title?: string;
  cover?: string;
  intro?: string;
  duration?: number;
  passtime?: number;
  statistic?: { sid?: number };
}

interface MusicResponse {
  code: number;
  message?: string;
  data?: AudioSong & { title?: string; menu_title?: string; data?: AudioSong[] };
}

function assertOk(body: { code: number; message?: string }): void {
  if (body.code !== 0) {
    throw new BiliError("API_ERROR", body.message ?? "音频接口返回错误", { apiCode: body.code });
  }
}

/** 取歌曲稳定 sid：of-menu 列表项以 statistic.sid 为准，单曲 song/info 的 statistic.sid 与 id 相同 */
function songSid(song: AudioSong, fallback: number | undefined): number | undefined {
  const sid = song.statistic?.sid ?? song.id ?? fallback;
  return sid !== undefined && sid > 0 ? sid : undefined;
}

/**
 * 音乐解析器。语义对齐桌面 parser/audio.py + episode/audio.py：
 * - au（单曲）→ song/info 单曲展开为一个条目；
 * - am（歌单）→ menu/info 取歌单标题，再 of-menu?pn=1&ps=100 取歌曲列表展开。
 * 条目下载取流只依赖 sid（music-service web/url）。
 */
export class AudioParser implements Parser {
  async parse(ctx: ParseContext, raw: string, _options?: ParseOptions): Promise<ParseResult> {
    const { type, token } = classifyUrl(raw);
    if (type !== "audio") {
      throw new BiliError("INVALID_URL", "不是音乐链接");
    }
    const isMenu = /^am/i.test(token);
    const numeric = Number(token.replace(/^am/i, "").replace(/^au/i, ""));
    if (!Number.isFinite(numeric) || numeric <= 0) {
      throw new BiliError("INVALID_URL", `无法识别的音乐编号：${token}`);
    }

    let songs: AudioSong[] = [];
    let containerTitle = "";
    if (isMenu) {
      // 歌单：先取标题（menu/info 的 data.title），再取歌曲列表
      const info = await ctx.http.getJSON<MusicResponse>(`${AUDIO_API_BASE}/menu/info`, {
        params: { sid: numeric },
      });
      assertOk(info);
      containerTitle = info.data?.title ?? "";
      const list = await ctx.http.getJSON<MusicResponse>(`${AUDIO_API_BASE}/song/of-menu`, {
        params: { sid: numeric, pn: 1, ps: 100 },
      });
      assertOk(list);
      songs = list.data?.data ?? [];
      if (songs.length === 0) {
        throw new BiliError("API_ERROR", "歌单中没有可下载的歌曲");
      }
    } else {
      const info = await ctx.http.getJSON<MusicResponse>(`${AUDIO_API_BASE}/song/info`, {
        params: { sid: numeric },
      });
      assertOk(info);
      if (!info.data) {
        throw new BiliError("API_ERROR", "音频接口未返回歌曲信息");
      }
      containerTitle = info.data.title ?? "";
      songs = [info.data];
    }

    const items: MediaItem[] = [];
    for (const song of songs) {
      const sid = songSid(song, numeric);
      if (sid === undefined) continue;
      items.push({
        id: `audio:au${sid}`,
        type: "audio",
        auId: sid,
        sid,
        page: items.length + 1,
        title: song.title ?? "",
        // 歌单用歌单名做父级目录；单曲无父级（默认规则 {parent_title}/... 的空段会被归一化丢弃）
        groupTitle: containerTitle || "",
        duration: song.duration ?? 0,
        badge: "",
        cover: song.cover ?? "",
        pubtime: song.passtime ?? 0,
        owner: { mid: song.uid ?? 0, name: song.author ?? song.uname ?? "", face: "" },
        desc: song.intro ?? "",
        url: `https://www.bilibili.com/audio/au${sid}`,
      });
    }
    if (items.length === 0) {
      throw new BiliError("API_ERROR", "没有可下载的歌曲");
    }
    return { type: "audio", title: containerTitle, items };
  }
}

