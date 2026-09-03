import { createHash } from "node:crypto";

/**
 * WBI 签名。
 * 算法与桌面版 src/util/parse/parser/base.py 的 enc_wbi 一致，
 * 混排表 mixinKeyEncTab 原样抄录。
 */

/** 与 Python mixinKeyEncTab 一致的混排表 */
export const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
  61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
  36, 20, 34, 44, 52,
] as const;

/** 由 img_key + sub_key 派生 mixin key（取混排后前 32 字符） */
export function getMixinKey(imgKey: string, subKey: string): string {
  const orig = imgKey + subKey;
  let out = "";
  for (const i of MIXIN_KEY_ENC_TAB) {
    out += orig[i];
  }
  return out.slice(0, 32);
}

export type WbiParams = Record<string, string | number | boolean>;

/**
 * Python urllib.parse.quote_plus(safe="") 等价实现：
 * 保留 A-Za-z0-9_.-~，空格转 '+'，其余按 UTF-8 百分号编码（大写十六进制）。
 * 注意与 encodeURIComponent 不同：空格、~、!()*' 的编码方式有差异，
 * B 站 wbi 校验要求与 Python 服务端一致。
 */
export function pyQuotePlus(value: string): string {
  let out = "";
  for (const ch of value) {
    if (/[A-Za-z0-9_.~-]/.test(ch)) {
      out += ch;
    } else if (ch === " ") {
      out += "+";
    } else {
      const bytes = Buffer.from(ch, "utf8");
      for (const b of bytes) {
        out += `%${b.toString(16).toUpperCase()}`;
      }
    }
  }
  return out;
}

function filterForbidden(value: string): string {
  // Python: "".join(filter(lambda c: c not in "!'()*", str(v)))
  return value.replace(/[!'()*]/g, "");
}

/**
 * 对参数做 WBI 签名：加入 wts，按键排序，过滤非法字符后 urlencode，
 * 追加 w_rid = md5(query + mixin_key)。返回可直接随请求发送的完整参数。
 */
export function wbiSign(
  params: WbiParams,
  imgKey: string,
  subKey: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Record<string, string> {
  const mixinKey = getMixinKey(imgKey, subKey);
  const merged: Record<string, string> = { wts: String(nowSeconds) };
  for (const [k, v] of Object.entries(params)) {
    merged[k] = filterForbidden(String(v));
  }

  const sortedKeys = Object.keys(merged).sort();
  const query = sortedKeys.map((k) => `${k}=${pyQuotePlus(merged[k] ?? "")}`).join("&");
  const wRid = createHash("md5").update(query + mixinKey).digest("hex");

  return { ...merged, w_rid: wRid };
}
