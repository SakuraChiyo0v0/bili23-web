/**
 * 扫码登录原语（对应桌面 util/auth/qrcode.py 的 TS 移植）。
 * 只负责与 B 站 passport 交互：生成二维码、轮询扫码状态。
 * 登录成功后 B 站会在 poll 响应里 Set-Cookie SESSDATA/bili_jct/DedeUserID，
 * 由 HttpClient 捕获进 cookie jar；调用方决定是否持久化。
 *
 * 状态码语义参见桌面 util/common/enum.py QRCodeScanStatus：
 *   0      = 扫码成功（本轮视为 SUCCESS）
 *   86090  = 二维码已过期
 *   86101  = 未扫码
 *   86102  = 已扫码待确认
 *   86038  = 已确认（PSD 登录成功前奏，等同成功，按 code===0 处理）
 *   86007  = 已确认（部分接口返回）
 */
import type { HttpClient } from "./http.js";

export enum QRCodeStatus {
  UNSCANNED = 86101,
  SCANNED = 86102,
  EXPIRED = 86090,
  CONFIRMED = 86038,
  SUCCESS = 0,
}

/** qrcode/generate 返回值 */
export interface QRGenerateResult {
  /** 二维码内容（B 站登录引导 URL），前端渲染为二维码图片 */
  url: string;
  /** 轮询用 key */
  qrcodeKey: string;
}

interface QRGenerateResponse {
  code: number;
  data?: { url?: string; qrcode_key?: string };
  message?: string;
}

interface QRPollResponse {
  code: number;
  data?: { code?: number; message?: string; url?: string };
  message?: string;
}

const GENERATE_URL = "https://passport.bilibili.com/x/passport-login/web/qrcode/generate";
const POLL_URL = "https://passport.bilibili.com/x/passport-login/web/qrcode/poll";

/** 生成二维码。返回二维码引导 URL 与轮询 key；业务失败（code!==0）抛 BiliError */
export async function qrGenerate(http: HttpClient): Promise<QRGenerateResult> {
  const body = await http.getJSON<QRGenerateResponse>(GENERATE_URL, {
    params: {
      source: "main-fe-header",
      go_url: "https://www.bilibili.com/",
    },
  });
  if (body.code !== 0 || !body.data?.url || !body.data.qrcode_key) {
    throw new Error(`二维码生成失败：${body.message || `code ${body.code}`}`);
  }
  return { url: body.data.url, qrcodeKey: body.data.qrcode_key };
}

/**
 * 轮询扫码状态。
 * - 返回 QRCodeStatus 枚举（未扫码/已扫待确认/过期/成功）。
 * - 成功时 B 站在响应 Set-Cookie 里下发登录 cookie，HttpClient 已捕获进 jar；
 *   若要完整 cookie（bili_jct/DedeUserID），由调用方读 http.jar 持久化。
 * - 非 0 业务码或异常向上抛，由调用方决定是否继续轮询。
 */
export async function qrPoll(http: HttpClient, qrcodeKey: string): Promise<QRCodeStatus> {
  const body = await http.getJSON<QRPollResponse>(POLL_URL, {
    params: { qrcode_key: qrcodeKey },
  });
  if (body.code !== 0) {
    throw new Error(`二维码轮询失败：${body.message || `code ${body.code}`}`);
  }
  const code = body.data?.code;
  // code===0 表示扫码登录成功（B 站已下发 cookie）；86102/86101/86090 为过程态
  return (code as QRCodeStatus) ?? QRCodeStatus.UNSCANNED;
}
