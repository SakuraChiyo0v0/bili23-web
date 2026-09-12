import { useCallback, useEffect, useState } from "react";
import { mcpStatus } from "../services/client";
import { Icon } from "../lib/icons";
import { t as tr } from "../lib/i18n";
import { Overlay } from "./Overlay";

/**
 * MCP 服务器设置卡的内容 —— 对齐原版 MCPSettingCard（`card.py:707-862`）：
 *
 * | 原版 | 这里 |
 * |---|---|
 * | `Enable MCP Server`=启用 MCP 服务器（副标题：仅监听本地回环地址，默认关闭） | 开关 |
 * | `Access Token`=访问令牌 + `Copy`=复制 / `Regenerate`=重新生成（带确认） | 同左 |
 * | `Client Configuration`=客户端配置 + `Copy`=复制（HTTP / stdio 二选一） | HTTP 配置 + 复制 |
 * | `View Documentation`=查看帮助文档 | 同左 |
 * | `Failed to start: {error}` | 同左（读 `/api/mcp/status`） |
 *
 * 三处如实记的 Web 差异：
 * 1. **stdio 桥接不做**：原版那个 `{"command": <程序路径>, "args":["--mcp-stdio"]}` 是让 AI 客户端
 *    在本机起一个进程去桥接本地程序；Web 端没有"本机程序"可桥，给出这个配置就是**假的**。
 * 2. **配置里的地址用当前访问的主机名**（而不是固定 127.0.0.1）：桌面程序服务本机，
 *    而 Web 端 AI 客户端多半从别的机器连过来，写死回环会直接连不上。
 * 3. 令牌变化**不需要重启**（每个请求按当前令牌校验），但原版是重启 —— 控制器的签名里跟随原版行为。
 */
export function McpCardBody({
  cfg, onPatch, toast,
}: {
  cfg: { mcpEnabled?: boolean; mcpPort?: number; mcpToken?: string; mcpBindAddress?: string };
  onPatch: (patch: { advanced: Record<string, unknown> }) => void;
  toast: (msg: string, tone?: "ok" | "err" | "warn" | "info") => void;
}) {
  const [status, setStatus] = useState<{ running: boolean; lastError: string }>({ running: false, lastError: "" });
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [showToken, setShowToken] = useState(false);

  const refresh = useCallback(async () => {
    try { setStatus(await mcpStatus()); } catch { /* 状态读取失败不影响设置 */ }
  }, []);
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const token = cfg.mcpToken ?? "";
  const port = cfg.mcpPort ?? 23330;
  // 用当前访问的主机名：AI 客户端多半从别的机器连过来（写死 127.0.0.1 会连不上）
  const host = typeof window !== "undefined" ? window.location.hostname || "127.0.0.1" : "127.0.0.1";
  const clientConfig = JSON.stringify(
    { type: "http", url: `http://${host}:${port}/mcp`, headers: { Authorization: `Bearer ${token || "<访问令牌>"}` } },
    null,
    2,
  );

  const copy = async (textValue: string, label: string) => {
    try { await navigator.clipboard.writeText(textValue); toast(`${label}已复制`, "ok"); }
    catch { toast(tr("复制被浏览器拒绝，请手动选择"), "warn"); }
  };

  const regen = () => {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const fresh = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    onPatch({ advanced: { mcpToken: fresh } });
    setConfirmRegen(false);
    toast(tr("已生成新令牌"), "ok");
  };

  return (
    <>
      <Row2 label={tr("启用 MCP 服务器")} desc={tr("仅监听所选地址，默认关闭")}>
        <Toggle checked={cfg.mcpEnabled === true} onChange={(v) => onPatch({ advanced: { mcpEnabled: v } })} />
      </Row2>

      {cfg.mcpEnabled && (
        <>
          <Row2 label={tr("监听地址")} desc={tr("默认 127.0.0.1（与原版一致）。要让局域网里的 AI 客户端连上，改成 0.0.0.0")}>
            <select className="text-input" style={{ width: 200 }} value={cfg.mcpBindAddress ?? "127.0.0.1"}
              onChange={(e) => onPatch({ advanced: { mcpBindAddress: e.target.value } })}>
              <option value="127.0.0.1">127.0.0.1（仅本机）</option>
              <option value="0.0.0.0">0.0.0.0（所有网卡）</option>
            </select>
          </Row2>
          <Row2 label={tr("端口")} desc={tr("1024–65535，默认 23330")}>
            <input className="text-input" type="number" min={1024} max={65535} style={{ width: 120 }} value={port}
              onChange={(e) => onPatch({ advanced: { mcpPort: Number(e.target.value) || 23330 } })} />
          </Row2>
          <Row2 label={tr("访问令牌")} desc={tr("每次请求都需要提供，请像密码一样妥善保管")}>
            <span className="mcp-token">
              <code className="mcp-token-text">{showToken ? (token || "（还没有令牌）") : token ? "••••••••••••••••••••••••" : tr("（还没有令牌）")}</code>
              <button type="button" className="btn sm ghost" onClick={() => setShowToken((v) => !v)}>{showToken ? tr("隐藏") : tr("显示")}</button>
              <button type="button" className="btn sm" disabled={!token} onClick={() => void copy(token, "访问令牌")}>{tr("复制")}</button>
              <button type="button" className="btn sm" onClick={() => setConfirmRegen(true)}>{tr("重新生成")}</button>
            </span>
          </Row2>
          <Row2 label={tr("客户端配置")} desc={tr("复制可直接使用的 MCP 客户端配置（HTTP 直连）")}>
            <button type="button" className="btn sm" onClick={() => void copy(clientConfig, "客户端配置")}>{tr("复制")}</button>
          </Row2>
          <div className="mcp-config"><pre className="meta-pre">{clientConfig}</pre></div>
          <Row2 label={tr("运行状态")} desc={status.lastError ? `启动失败：${status.lastError}` : "启动失败会显示在这里"}>
            <span className={`status-chip ${status.running ? "done" : cfg.mcpEnabled ? "failed" : "queued"}`}>
              {status.running ? "运行中" : status.lastError ? tr("启动失败") : tr("未运行")}
            </span>
          </Row2>
          <Row2 label={tr("帮助文档")} desc={tr("MCP 服务器的使用说明（原版指向项目文档站）")}>
            <a className="btn sm ghost" href="https://bili23.scott-sloan.cn/doc/mcp-server.html" target="_blank" rel="noreferrer">{tr("查看帮助文档")}</a>
          </Row2>
          <p className="small muted" style={{ padding: "0 16px 10px" }}>
            stdio 桥接不做：那是让 AI 客户端在本机起进程去桥接桌面程序，Web 端没有本机程序可桥，
            给出这样的配置是假的。
          </p>
        </>
      )}

      {confirmRegen && (
        <Overlay open dismissable={false} size="sm">
            <div className="modal-head">
              <div className="modal-title">{tr("重新生成访问令牌")}</div>
              <button type="button" className="icon-btn" onClick={() => setConfirmRegen(false)} aria-label={tr("关闭")}><Icon name="x" size={18} /></button>
            </div>
            <div className="modal-body">
              <p className="small">现有 AI 客户端将停止工作，直到用新令牌重新配置。是否继续？</p>
            </div>
            <div className="modal-foot">
              <div className="right">
                <button type="button" className="btn" onClick={() => setConfirmRegen(false)}>{tr("取消")}</button>
                <button type="button" className="btn primary" onClick={regen}>{tr("继续")}</button>
              </div>
            </div>
          </Overlay>
      )}
    </>
  );
}

/** 卡片体内的一行（与设置页既有 Row 同构，避免跨文件依赖） */
function Row2({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="setting-row">
      <div className="s-info">
        <div className="s-title">{label}</div>
        {desc && <div className="s-desc">{desc}</div>}
      </div>
      <div className="control">{children}</div>
    </div>
  );
}

/** 开关（与设置页既有 Toggle 同构） */
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" className={`switch${checked ? " on" : ""}`} role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>
      <span className="knob" />
    </button>
  );
}
