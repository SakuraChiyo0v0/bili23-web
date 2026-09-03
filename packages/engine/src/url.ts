/**
 * B 站链接识别。
 * 顺序与桌面版 src/util/common/data/url_pattern.py 完全一致：
 * 先域名/路径精确匹配，最后才用裸 BV/av、ep/ss/md、am/au 兜底。
 * 首个命中的类型生效；b23 短链需要后续跟随跳转才能得到真实类型。
 */

export type ContentType =
  | "video"
  | "bangumi"
  | "cheese"
  | "lesson"
  | "list"
  | "favlist"
  | "space"
  | "popular"
  | "watch_later"
  | "history"
  | "festival"
  | "audio"
  | "b23"
  | "unknown";

export interface UrlClassify {
  type: ContentType;
  /** 命中的标识串（取最后一个非空捕获组；无捕获组则为空串） */
  token: string;
}

/** 与 Python url_patterns 顺序一致的模式表 */
export const URL_PATTERNS: ReadonlyArray<readonly [ContentType, RegExp]> = [
  ["video", /bilibili\.com\/video\/([a-zA-Z0-9]+)/],
  ["bangumi", /bilibili\.com\/bangumi\/(play|media)\/(ss\d+|ep\d+|md\d+)/],
  ["cheese", /bilibili\.com\/cheese\/play\/(ss\d+|ep\d+)/],
  ["lesson", /mall\.bilibili\.com\/lesson\/play/],
  ["list", /space\.bilibili\.com\/(\d+)\/lists/],
  ["favlist", /space\.bilibili\.com\/(\d+)\/favlist/],
  ["favlist", /www\.bilibili\.com\/list\/ml(\d+)/],
  ["space", /space\.bilibili\.com\/(\d+)/],
  ["space", /www\.bilibili\.com\/medialist\/play\/(\d+)/],
  ["list", /bilibili\.com\/list\/(\d+)/],
  ["popular", /bilibili\.com\/v\/popular/],
  ["watch_later", /bili23:\/\/watch_later/],
  ["history", /bili23:\/\/history/],
  ["festival", /bilibili\.com\/festival/],
  ["b23", /(b23\.tv|bili2233\.cn)/],
  ["video", /((?:BV|bv|AV|av)\w+)/],
  ["bangumi", /(ep[0-9]+|ss[0-9]+)|md[0-9]+/],
  ["audio", /(am[0-9]+)|(au[0-9]+)/],
];

export function classifyUrl(raw: string): UrlClassify {
  const input = raw.trim();

  for (const [type, pattern] of URL_PATTERNS) {
    const m = pattern.exec(input);
    if (m) {
      // 取最后一个非空捕获组：多分支/多组模式（如 bangumi 的 play|id）都以 id 结尾
      let token = "";
      for (let i = m.length - 1; i >= 1; i -= 1) {
        const group = m[i];
        if (group !== undefined) {
          token = group;
          break;
        }
      }
      return { type, token };
    }
  }

  return { type: "unknown", token: "" };
}

