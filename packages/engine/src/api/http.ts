import { EnvHttpProxyAgent, ProxyAgent } from "undici";

/** `#proxy` 的哨兵值：表示"跟随系统代理"（区别于 undefined = 不使用代理） */
const SYSTEM_PROXY = Symbol("system-proxy");
import { BiliError } from "../errors.js";
import { CookieJar } from "./cookies.js";

export type HttpMethod = "GET" | "POST" | "HEAD";

export interface HttpRequestOptions {
  /** 查询参数，null/undefined 值会被忽略 */
  params?: Record<string, string | number | undefined>;
  /** 附加请求头（会覆盖默认 Referer/User-Agent/Cookie） */
  headers?: Record<string, string>;
  /** POST JSON 体（自动设置 Content-Type: application/json） */
  json?: unknown;
  /** 原始请求体 */
  body?: string;
  /** 单次超时（毫秒），默认取客户端配置 */
  timeoutMs?: number;
  /** 覆盖客户端默认重试次数 */
  retries?: number;
  /** 中止信号 */
  signal?: AbortSignal;
}

export interface HttpClientOptions {
  /** 默认 UA，可被单请求 headers 覆盖；语义对齐桌面 config.user_agent */
  ua?: string;
  /** 默认 Referer，对齐桌面（bilibili 校验来源） */
  referer?: string;
  cookieJar?: CookieJar;
  /** 单次请求超时（毫秒），默认 10_000 */
  timeoutMs?: number;
  /** 失败重试次数（网络错误/5xx/429），默认 3；对齐桌面 transport retries */
  retries?: number;
  /** 测试注入用 */
  fetchImpl?: typeof fetch;
  /** HTTP(S) 代理地址（如 http://127.0.0.1:7890） */
  proxy?: string;
}

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function appendParams(url: string, params?: Record<string, string | number | undefined>): string {
  if (!params) return url;
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      usp.set(key, String(value));
    }
  }
  const qs = usp.toString();
  if (!qs) return url;
  return url + (url.includes("?") ? "&" : "?") + qs;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/** 可重试的网络异常：undici/浏览器 fetch 网络失败抛 TypeError */
function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError || (err instanceof DOMException && err.name === "AbortError");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class HttpClient {
  #ua: string;
  readonly referer: string;
  readonly jar: CookieJar;
  readonly timeoutMs: number;
  readonly retries: number;
  #fetch: typeof fetch;
  #proxy: string | typeof SYSTEM_PROXY | undefined = undefined;
  #agent: ProxyAgent | EnvHttpProxyAgent | undefined = undefined;
  /**
   * 构造时是否注入了 fetch 替身（测试用）。
   * 注入的 fetch **就是传输层本身** —— 切换代理时不能把它换掉，
   * 否则会把替身冲成真实 fetch（踩过：一条用 mock 的单测因此真的去请求了线上接口）。
   */
  #injectedFetch: boolean;

  constructor(opts: HttpClientOptions = {}) {
    this.#ua = opts.ua ?? DEFAULT_UA;
    this.referer = opts.referer ?? "https://www.bilibili.com/";
    this.jar = opts.cookieJar ?? new CookieJar();
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.retries = opts.retries ?? 3;
    this.#injectedFetch = Boolean(opts.fetchImpl);
    this.#fetch = opts.fetchImpl ?? (opts.proxy ? this.#makeProxyFetch(opts.proxy) : fetch);
    this.#proxy = opts.proxy;
  }

  /** 当前 UA（只读视图；改它用 `setDefaultUserAgent`） */
  get ua(): string {
    return this.#ua;
  }

  /**
   * 运行时改默认 UA（对齐桌面「高级 > User-Agent」改动即时生效）。
   * 空白串按"没填"处理回落到内置默认 —— 服务端校验也会拦空 UA，这里是第二道。
   */
  setDefaultUserAgent(ua?: string): void {
    const next = ua && ua.trim() !== "" ? ua : DEFAULT_UA;
    if (next === this.#ua) return;
    this.#ua = next;
  }

  /** 发起请求（带 cookie/UA/Referer/重试），返回原始 Response（调用方负责消费） */
  async request(method: HttpMethod, url: string, opts: HttpRequestOptions = {}): Promise<Response> {
    const fullUrl = appendParams(url, opts.params);
    const timeoutMs = opts.timeoutMs ?? this.timeoutMs;
    const retries = opts.retries ?? this.retries;

    const headers: Record<string, string> = {
      Referer: this.referer,
      "User-Agent": this.ua,
      ...(opts.headers ?? {}),
    };
    const cookieHeader = this.jar.toHeader();
    if (cookieHeader && headers.Cookie === undefined) {
      headers.Cookie = cookieHeader;
    }

    const init: RequestInit = { method, headers, redirect: "follow" };
    if (opts.json !== undefined) {
      init.body = JSON.stringify(opts.json);
      headers["Content-Type"] = "application/json";
    } else if (opts.body !== undefined) {
      init.body = opts.body;
    }
    if (opts.signal) {
      init.signal = opts.signal;
    }

    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const signal = opts.signal ? AbortSignal.any([opts.signal, controller.signal]) : controller.signal;
      try {
        const response = await this.#fetch(fullUrl, { ...init, signal });
        this.#captureSetCookie(response.headers);

        if (!response.ok && RETRYABLE_STATUS.has(response.status) && attempt < retries) {
          await sleep(200 * (attempt + 1));
          continue;
        }
        return response;
      } catch (err) {
        lastError = err;
        if (!isNetworkError(err)) throw err;
        if (attempt < retries) {
          await sleep(200 * (attempt + 1));
          continue;
        }
        break;
      } finally {
        clearTimeout(timer);
      }
    }

    throw new BiliError("NETWORK", `请求失败：${method} ${fullUrl}`, { cause: lastError });
  }

  /** 运行时切换代理（配置更新用）；无代理时回退全局 fetch */
  setProxy(proxy?: string): void {
    if (this.#injectedFetch) return;
    if (proxy === this.#proxy) return;
    this.#proxy = proxy;
    this.#agent?.close().catch(() => undefined);
    this.#agent = undefined;
    this.#fetch = proxy ? this.#makeProxyFetch(proxy) : fetch;
  }

  /**
   * 跟随系统代理（对齐桌面 `ProxyMode.SYSTEM`）。
   *
   * ⚠️ 为什么需要单独一个方法：Node 内置 fetch **不会**读 `HTTP_PROXY` / `HTTPS_PROXY`，
   * 所以"跟随系统"如果不显式装 `EnvHttpProxyAgent`，就会和"不使用代理"表现完全一样 ——
   * 那就是个假开关。桌面版 `SYSTEM` 语义就是"环境变量 + 系统代理设置"。
   */
  setSystemProxy(): void {
    if (this.#injectedFetch) return;
    if (this.#proxy === SYSTEM_PROXY) return;
    this.#proxy = SYSTEM_PROXY;
    this.#agent?.close().catch(() => undefined);
    this.#agent = undefined;
    const agent = new EnvHttpProxyAgent();
    this.#agent = agent;
    this.#fetch = ((input, init) => {
      const options = (init ?? {}) as RequestInit & { dispatcher?: unknown };
      return fetch(input, { ...options, dispatcher: agent as never });
    }) as typeof fetch;
  }

  /** 用 undici ProxyAgent 包装 fetch（HTTP 代理，解析与取流共用） */
  #makeProxyFetch(proxy: string): typeof fetch {
    const agent = new ProxyAgent(proxy);
    this.#agent = agent;
    return ((input, init) => {
      const options = (init ?? {}) as RequestInit & { dispatcher?: unknown };
      return fetch(input, { ...options, dispatcher: agent as never });
    }) as typeof fetch;
  }

  #captureSetCookie(headers: Headers): void {
    const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
    if (typeof getSetCookie === "function") {
      this.jar.updateFromSetCookie(getSetCookie.call(headers));
    }
  }


  /** POST 并解析 JSON（body 以 opts.json 传入，自动带 Content-Type: application/json） */
  async postJSON<T = unknown>(url: string, opts: HttpRequestOptions = {}): Promise<T> {
    const response = await this.request("POST", url, opts);
    if (!response.ok) {
      throw new BiliError("API_ERROR", `HTTP ${response.status} ${response.statusText}`);
    }
    const text = await response.text();
    try {
      return JSON.parse(text) as T;
    } catch (err) {
      throw new BiliError("API_ERROR", `响应不是合法 JSON`, { cause: err });
    }
  }
  /** GET 并解析 JSON（文本按 JSON.parse 处理） */
  async getJSON<T = unknown>(url: string, opts: HttpRequestOptions = {}): Promise<T> {
    const response = await this.request("GET", url, opts);
    if (!response.ok) {
      throw new BiliError("API_ERROR", `HTTP ${response.status} ${response.statusText}`);
    }
    const text = await response.text();
    try {
      return JSON.parse(text) as T;
    } catch (err) {
      throw new BiliError("API_ERROR", `响应不是合法 JSON`, { cause: err });
    }
  }

  /** GET 纯文本 */
  async getText(url: string, opts: HttpRequestOptions = {}): Promise<string> {
    const response = await this.request("GET", url, opts);
    if (!response.ok) {
      throw new BiliError("API_ERROR", `HTTP ${response.status} ${response.statusText}`);
    }
    return response.text();
  }

  /** GET 字节内容（取流/封面下载等） */
  async getBuffer(url: string, opts: HttpRequestOptions = {}): Promise<Uint8Array> {
    const response = await this.request("GET", url, opts);
    if (!response.ok) {
      throw new BiliError("API_ERROR", `HTTP ${response.status} ${response.statusText}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  /** 跟随跳转后的最终 URL（b23 短链解析用），不读取响应体 */
  async getRedirect(url: string, opts: HttpRequestOptions = {}): Promise<string> {
    const response = await this.request("GET", url, opts);
    const finalUrl = response.url || url;
    await response.body?.cancel().catch(() => undefined);
    return finalUrl;
  }
}
