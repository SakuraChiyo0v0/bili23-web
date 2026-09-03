import { createHmac } from "node:crypto";
import type { HttpClient } from "./http.js";
import type { ParseContext } from "../parser/types.js";

/**
 * 匿名会话 cookie 引导（桌面 CookieManager.init_cookie_info 的 TS 移植）。
 * 桌面在应用启动时就生成/获取一组"匿名指纹" cookie（buvid3/4、_uuid、b_lsid、
 * b_nut、buvid_fp、bili_ticket 等），全程随请求发送，用于通过 B 站风控
 * （尤其 x/space/wbi/arc/search、popular 等 WBI 接口，裸请求会间歇性 412）。
 *
 * 本模块只做最佳努力：任一子步骤失败都不向外抛（桌面同样异步执行、失败仅提示），
 * 未拿到 cookie 时保持现有行为（请求可能被 412，属风控而非代码错误）。
 */

const MASK64 = (1n << 64n) - 1n;
const M1 = 0x87c37b91114253d5n;
const M2 = 0x4cf5ad432745937fn;
const M3 = 0x52dce729n;
const M4 = 0x38495ab5n;

function rotl64(x: bigint, k: number): bigint {
  return ((x << BigInt(k)) | (x >> BigInt(64 - k))) & MASK64;
}

function fmix64(k: bigint): bigint {
  let tmp = k;
  tmp = (tmp ^ (tmp >> 33n)) & MASK64;
  tmp = (tmp * 0xff51afd7ed558ccdn) & MASK64;
  tmp = (tmp ^ (tmp >> 33n)) & MASK64;
  tmp = (tmp * 0xc4ceb9fe1a85ec53n) & MASK64;
  tmp = (tmp ^ (tmp >> 33n)) & MASK64;
  return tmp;
}

/** 桌面 get_buvid_fp：murmur3_x64_128(seed=31) 的 hex(低64)+hex(高64) */
export function buvidFpHex(key: string): string {
  const bytes = Buffer.from(key, "ascii");
  const total = BigInt(bytes.length);
  let h1 = 31n;
  let h2 = 31n;

  let offset = 0;
  while (bytes.length - offset >= 16) {
    const k1 = bytes.readBigUInt64LE(offset);
    const k2 = bytes.readBigUInt64LE(offset + 8);
    h1 ^= (rotl64((k1 * M1) & MASK64, 31) * M2) & MASK64;
    h1 = ((rotl64(h1, 27) + h2) * 5n + M3) & MASK64;
    h2 ^= (rotl64((k2 * M2) & MASK64, 33) * M1) & MASK64;
    h2 = ((rotl64(h2, 31) + h1) * 5n + M4) & MASK64;
    offset += 16;
  }
  const rem = bytes.length - offset;
  if (rem > 0) {
    let k1 = 0n;
    let k2 = 0n;
    for (let i = 0; i < rem; i += 1) {
      const v = BigInt(bytes[offset + i] as number);
      if (i < 8) k1 ^= v << BigInt(8 * i);
      else k2 ^= v << BigInt(8 * (i - 8));
    }
    k1 = (rotl64((k1 * M1) & MASK64, 31) * M2) & MASK64;
    h1 ^= k1;
    k2 = (rotl64((k2 * M2) & MASK64, 33) * M1) & MASK64;
    h2 ^= k2;
  }

  h1 ^= total;
  h2 ^= total;
  h1 = (h1 + h2) & MASK64;
  h2 = (h2 + h1) & MASK64;
  h1 = fmix64(h1);
  h2 = fmix64(h2);
  h1 = (h1 + h2) & MASK64;
  h2 = (h2 + h1) & MASK64;
  const m = (h2 << 64n) | h1;
  return `${(m & MASK64).toString(16)}${(m >> 64n).toString(16)}`;
}

/** 桌面 get_uuid：8-4-4-4-12 随机段 + 时间戳尾缀 + "infoc" */
export function makeUuid(nowSeconds = Math.floor(Date.now() / 1000)): string {
  const pool = ["1","2","3","4","5","6","7","8","9","A","B","C","D","E","F","10"];
  const lens = [8, 4, 4, 4, 12];
  const gen = (n: number): string => Array.from({ length: n }, () => pool[Math.floor(Math.random() * pool.length)]).join("");
  return lens.map(gen).join("-") + String(nowSeconds % 100000).padStart(5, "0") + "infoc";
}

/** 桌面 get_b_lsid：8 位随机十六进制 + "_" + 时间戳十六进制（大写） */
export function makeBLsid(nowSeconds = Math.floor(Date.now() / 1000)): string {
  let ret = "";
  for (let i = 0; i < 8; i += 1) ret += Math.floor(Math.random() * 16).toString(16).toUpperCase();
  return `${ret}_${nowSeconds.toString(16).toUpperCase()}`;
}

interface SpiResponse {
  code: number;
  data?: { b_3?: string; b_4?: string };
}

interface TicketResponse {
  code: number;
  data?: { ticket?: string; expires_in?: number };
}

function hmacSha256Hex(key: string, message: string): string {
  return createHmac("sha256", key).update(message).digest("hex");
}

/**
 * 生成/获取匿名指纹 cookie 并写入 http 的 cookie jar。
 * 任一子步骤失败只跳过该项（桌面同级别错误仅弹提示，不阻断后续请求）。
 */
export async function ensureAnonymousSession(ctx: ParseContext): Promise<void> {
  const http: HttpClient = ctx.http;
  const now = Math.floor(Date.now() / 1000);
  const set = (name: string, value: string | undefined): void => {
    if (value) http.jar.set(name, value);
  };

  // 1) spi → buvid3/buvid4（新进程每次获取，等价桌面 buvid_expires 过期后重新获取）
  try {
    const spi = await http.getJSON<SpiResponse>("https://api.bilibili.com/x/frontend/finger/spi", { retries: 1 });
    if (spi.code === 0) {
      set("buvid3", spi.data?.b_3);
      set("buvid4", spi.data?.b_4);
    }
  } catch {
    // 忽略
  }

  // 2) 本地生成型 cookie
  set("_uuid", makeUuid(now));
  set("b_lsid", makeBLsid(now));
  set("b_nut", String(now));
  set("buvid_fp", buvidFpHex(http.ua));
  set("CURRENT_FNVAL", "4048");
  set("CURRENT_QUALITY", "0");

  // 3) bili_ticket（GenWebTicket，匿名 csrf 为空串）
  try {
    const ts = String(now);
    const body = await http.postJSON<TicketResponse>(
      "https://api.bilibili.com/bapis/bilibili.api.ticket.v1.Ticket/GenWebTicket",
      { params: { key_id: "ec02", hexsign: hmacSha256Hex("XgwSnGZ1p", `ts${ts}`), "context[ts]": ts, csrf: "" } },
    );
    if (body.code === 0) {
      set("bili_ticket", body.data?.ticket);
      if (body.data?.expires_in) set("bili_ticket_expires", String(now + body.data.expires_in));
    }
  } catch {
    // 忽略
  }
}