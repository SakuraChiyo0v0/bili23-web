import { useMemo } from "react";
import { loadJSON } from "../lib/storage";
import { TERMS_VERSION } from "../lib/useTermsGate";

const DEFAULT_SECTIONS = [
  ["责任边界", "本软件仅用于个人学习与研究目的。通过本项目下载的任何内容仅限个人、非商业使用，不得用于商业用途、公开传播、共享、转售或任何非法获利。"],
  ["访问授权", "本软件仅基于你自己的账号合法访问权限工作，不绕过任何付费墙、会员限制或技术保护措施。只能下载你正常登录后有权访问的内容；账号无权限的内容，不得借助本软件获取。"],
  ["合规与风险", "不得使用本软件进行批量抓取、未经授权的再分发，或任何违反目标平台服务条款的行为。因使用本软件产生的一切后果由使用者自行承担，包括但不限于账号封禁、版权争议或其他法律问题。"],
  ["免责声明", "任何情况下，开发者均不对因使用或无法使用本软件导致的直接、间接、偶然或后果性损害承担责任。继续使用本软件即表示你已阅读、理解并同意遵守以上全部条款。"],
] as const;

export function TermsPanel({ compact = false }: { compact?: boolean }) {
  const historyExtra = useMemo(() => {
    try {
      return loadJSON<string[]>("terms.history", []).length;
    } catch {
      return 0;
    }
  }, []);
  return (
    <div className="terms-scroll">
      <h3>条款文本（v{TERMS_VERSION}）</h3>
      {DEFAULT_SECTIONS.map(([k, v]) => (
        <p key={k}>
          <b>{k}：</b>
          {v}
        </p>
      ))}
      {historyExtra > 0 && <p className="small muted">本地另有 {historyExtra} 条历史更新记录，将在正式条款页展示。</p>}
      {compact && <p className="small muted">（此版本为按原版条款语义编写的骨架文本，正式文案与协议跳转将在后续确定。）</p>}
    </div>
  );
}