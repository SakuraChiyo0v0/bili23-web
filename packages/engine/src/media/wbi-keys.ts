import { BiliError } from "../errors.js";
import type { ParseContext } from "../parser/types.js";

/**
 * WBI 签名所需的 img/sub key：从 /x/web-interface/nav 的 wbi_img 里取文件名。
 * 未登录时该接口 code=-101 但仍会下发 wbi_img；key 变更概率低，进程内缓存，
 * 解析/取流期间共用同一对 key（桌面版亦把 key 存在全局配置里复用）。
 */
export interface WbiKeys {
  imgKey: string;
  subKey: string;
}

interface NavResponse {
  code: number;
  data?: {
    wbi_img?: {
      img_url?: string;
      sub_url?: string;
    };
  };
}

let cached: WbiKeys | undefined;

function keyFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const fileName = url.slice(url.lastIndexOf("/") + 1);
  const base = fileName.replace(/\.[^.]+$/, "");
  return base || undefined;
}

/** 清空进程内 key 缓存（测试用） */
export function resetWbiKeyCache(): void {
  cached = undefined;
}

export async function ensureWbiKeys(ctx: ParseContext): Promise<WbiKeys> {
  if (cached) return cached;

  const body = await ctx.http.getJSON<NavResponse>("https://api.bilibili.com/x/web-interface/nav");
  const imgKey = keyFromUrl(body.data?.wbi_img?.img_url);
  const subKey = keyFromUrl(body.data?.wbi_img?.sub_url);

  if (!imgKey || !subKey) {
    throw new BiliError("API_ERROR", "获取 WBI 签名 key 失败：nav 接口未返回 wbi_img");
  }

  cached = { imgKey, subKey };
  return cached;
}
