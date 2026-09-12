import { useEffect, useState } from "react";
import { testProxy } from "../services/client";
import type { ProxyTestResult } from "../services/types";
import { Icon } from "../lib/icons";
import { t as tr } from "../lib/i18n";
import { Overlay } from "./Overlay";

export interface ProxyForm {
  proxyType: "http";
  proxyServer: string;
  proxyPort: number;
  proxyUname: string;
  proxyPassword: string;
}

/**
 * 「设置代理服务器」弹窗 —— 对齐原版 `gui/dialog/setting/proxy.py`：
 * 代理类型 / 地址 / 端口 / 用户名（可选）/ 密码 + 「测试」按钮，
 * 测试成功显示 `IP：{ip}\nLocation：{location}\nISP：{isp}`，失败显示「代理测试失败」，测试中显示「测试中...」。
 *
 * 测试是**服务端**发起的（浏览器不能拿代理去请求），服务端走配置好的代理去问 B 站自己的
 * `x/web-interface/zone` —— 与原版同一个接口。
 */
export function ProxyDialog({
  open, value, onClose, onConfirm,
}: {
  open: boolean;
  value: ProxyForm;
  onClose: () => void;
  onConfirm: (next: ProxyForm) => void;
}) {
  const [form, setForm] = useState<ProxyForm>(value);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ProxyTestResult | null>(null);

  useEffect(() => { if (open) { setForm(value); setResult(null); } }, [open, value]);

  const patch = (p: Partial<ProxyForm>) => setForm((prev) => ({ ...prev, ...p }));

  const runTest = async () => {
    setTesting(true); setResult(null);
    try {
      setResult(await testProxy(form));
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Overlay open={open} onClose={onClose} size="sm">
        <div className="modal-head">
          <div className="modal-title">{tr("设置代理服务器")}</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={tr("关闭")}><Icon name="x" size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="dl-field">
            <span>{tr("代理类型")}</span>
            <select value={form.proxyType} onChange={(e) => patch({ proxyType: e.target.value as "http" })}>
              <option value="http">HTTP</option>
            </select>
          </div>
          <div className="dl-field">
            <span>{tr("地址")}</span>
            <input className="text-input" style={{ flex: 1 }} placeholder={tr("代理服务器地址")} value={form.proxyServer}
              onChange={(e) => patch({ proxyServer: e.target.value })} />
          </div>
          <div className="dl-field">
            <span>{tr("端口")}</span>
            <input className="text-input" type="number" min={1} max={65535} style={{ width: 120 }} placeholder={tr("代理服务器端口")}
              value={form.proxyPort} onChange={(e) => patch({ proxyPort: Number(e.target.value) || 0 })} />
          </div>
          <div className="dl-field">
            <span>{tr("用户名")}</span>
            <input className="text-input" style={{ flex: 1 }} placeholder={tr("可选")} value={form.proxyUname}
              onChange={(e) => patch({ proxyUname: e.target.value })} />
          </div>
          <div className="dl-field">
            <span>{tr("密码")}</span>
            <input className="text-input" style={{ flex: 1 }} type="password" value={form.proxyPassword}
              onChange={(e) => patch({ proxyPassword: e.target.value })} />
          </div>

          <div className="proxy-test">
            <button type="button" className="btn sm" onClick={() => void runTest()} disabled={testing}>
              {testing ? tr("测试中...") : tr("测试")}
            </button>
            {result && (
              result.ok ? (
                <pre className="proxy-result ok">{`IP：${result.ip}\nLocation：${result.location}\nISP：${result.isp}`}</pre>
              ) : (
                <span className="proxy-result err">代理测试失败{result.error ? `：${result.error}` : ""}</span>
              )
            )}
          </div>
        </div>
        <div className="modal-foot">
          <div className="right">
            <button type="button" className="btn" onClick={onClose}>{tr("取消")}</button>
            <button type="button" className="btn primary" onClick={() => onConfirm(form)}>{tr("确定")}</button>
          </div>
        </div>
      </Overlay>
  );
}
