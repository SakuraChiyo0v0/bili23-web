import { BiliError } from "../errors.js";
import type { ParseContext } from "./types.js";

/**
 * 需登录类型（watch_later/history）的登录前置检查。
 * 语义对齐桌面 ParserBase.check_login：未登录（无 SESSDATA）直接抛 LOGIN_REQUIRED，
 * 不发任何请求；接口层遇到 -101/-10403（会话失效）也映射为 LOGIN_REQUIRED。
 */
export function requireLogin(ctx: ParseContext, label: string): void {
  if (!ctx.http.jar.get("SESSDATA")) {
    throw new BiliError("LOGIN_REQUIRED", `需要登录后查看${label}（缺少 SESSDATA cookie）`);
  }
}