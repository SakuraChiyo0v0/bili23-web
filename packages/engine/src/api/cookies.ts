/**
 * 极简 Cookie 罐：面向 B 站单域场景（.bilibili.com），
 * 保存 name→value，并在每次请求时序列化为 Cookie 头。
 * 语义对齐桌面版 httpx cookiejar 在本项目中的用法（域名固定 .bilibili.com）。
 */
export class CookieJar {
  private cookies = new Map<string, string>();

  /** Set-Cookie 属性名，解析字符串时跳过 */
  private static ATTRIBUTES = new Set(["path", "domain", "expires", "max-age", "secure", "httponly", "samesite", "priority"]);

  /** 从 "k1=v1; k2=v2" 形式的字符串载入（登录态还原用），跳过属性段 */
  static parse(header: string | null | undefined): CookieJar {
    const jar = new CookieJar();
    if (!header) return jar;
    for (const part of header.split(";")) {
      const idx = part.indexOf("=");
      if (idx === -1) continue;
      const name = part.slice(0, idx).trim();
      const value = part.slice(idx + 1).trim();
      if (name && !CookieJar.ATTRIBUTES.has(name.toLowerCase())) jar.set(name, value);
    }
    return jar;
  }

  set(name: string, value: string): void {
    this.cookies.set(name, value);
  }

  get(name: string): string | undefined {
    return this.cookies.get(name);
  }

  delete(...names: string[]): void {
    for (const name of names) this.cookies.delete(name);
  }

  has(name: string): boolean {
    return this.cookies.has(name);
  }

  /** 当前全部键值快照（登录态持久化用） */
  snapshot(): Record<string, string> {
    return Object.fromEntries(this.cookies);
  }

  /** 序列化为 Cookie 请求头；空罐返回 undefined（不带该头） */
  toHeader(): string | undefined {
    if (this.cookies.size === 0) return undefined;
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  /** 从响应的 Set-Cookie 头更新（捕获 buvid3/SESSDATA 等下发 cookie） */
  updateFromSetCookie(setCookies: Iterable<string>): void {
    for (const raw of setCookies) {
      const idx = raw.indexOf("=");
      if (idx === -1) continue;
      const name = raw.slice(0, idx).trim();
      const value = raw.slice(idx + 1).split(";")[0]?.trim() ?? "";
      if (name && !CookieJar.ATTRIBUTES.has(name.toLowerCase())) this.set(name, value);
    }
  }
}
