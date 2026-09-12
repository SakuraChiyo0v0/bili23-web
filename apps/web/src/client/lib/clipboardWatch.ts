/**
 * 剪贴板监控（Web 改写版）。
 *
 * 原版是**后台轮询系统剪贴板**（`monitor_clipboard`，默认关），发现 B 站链接就自动填入并解析。
 * 浏览器做不到这件事：没有后台剪贴板访问，`navigator.clipboard.readText()` 还要用户授权，
 * 且只在页面聚焦时才有意义。
 *
 * 所以这里的改写是：**页面重新聚焦时读一次剪贴板**（而不是定时轮询），
 * 命中链接就**只填入输入框并提示**，由用户点「解析」——
 * 不自动解析、更不自动下载（剪贴板里什么都可能有，浏览器里"悄悄开始下载"比桌面版更不可接受）。
 *
 * 本文件只放**纯逻辑**，便于单测；读剪贴板与事件绑定在 ParsePage 里。
 */

/** B 站链接识别：与解析器支持的入口一致（视频/番剧/课程/空间/收藏夹/合集/动态） */
const LINK_PATTERNS: RegExp[] = [
  // 完整 URL（含无协议形态）
  /(?:https?:\/\/)?(?:www\.|m\.|space\.|live\.)?bilibili\.com\/[^\s"'<>，。；、）)】]+/i,
  /(?:https?:\/\/)?b23\.tv\/[A-Za-z0-9]+/i,
  /(?:https?:\/\/)?(?:www\.)?bili2233\.cn\/[A-Za-z0-9]+/i,
  // 裸号码 / 编号（原版输入框也接受这些）
  /\b(?:BV[0-9A-Za-z]{10}|av\d+|ep\d+|ss\d+|md\d+)\b/,
];

/**
 * 从一段文本里取出第一个可解析的链接/编号；没有则返回 undefined。
 *
 * 会去掉常见的中文标点尾巴（复制来的链接常带「，」「）」等）。
 */
export function detectBiliLink(text: string | undefined | null): string | undefined {
  if (!text) return undefined;
  const cleaned = text.trim();
  if (!cleaned) return undefined;
  for (const re of LINK_PATTERNS) {
    const m = re.exec(cleaned);
    if (m) return m[0].replace(/[，。；、）)】\],.;:!?]+$/, "");
  }
  return undefined;
}
