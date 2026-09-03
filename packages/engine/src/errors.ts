/**
 * 统一错误类型。
 * 语义对齐桌面版异常分类；code 为机器可读错误码，供 UI/日志分支。
 */
export type BiliErrorCode =
  | "NETWORK"
  | "API_ERROR"
  | "INVALID_URL"
  | "LOGIN_REQUIRED"
  | "UNSUPPORTED_TYPE"
  | "DOWNLOAD_FAILED"
  | "MERGE_FAILED"
  | "UNKNOWN";

export interface BiliErrorOptions {
  /** B 站 API 返回的业务码（如 -404），可选 */
  apiCode?: number;
  cause?: unknown;
}

export class BiliError extends Error {
  readonly code: BiliErrorCode;
  readonly apiCode?: number;
  readonly cause?: unknown;

  constructor(code: BiliErrorCode, message: string, opts?: BiliErrorOptions) {
    super(message);
    this.name = "BiliError";
    this.code = code;
    if (opts?.apiCode !== undefined) {
      this.apiCode = opts.apiCode;
    }
    if (opts?.cause !== undefined) {
      this.cause = opts.cause;
    }
  }
}
