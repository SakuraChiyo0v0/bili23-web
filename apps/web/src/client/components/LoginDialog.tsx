import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { api } from "../api.js";
import { Icon } from "./icons.js";

export type QrLoginStatus =
  | "idle"
  | "loading"
  | "waiting"   // 已生成二维码，等待扫码
  | "scanned"   // 已扫码待确认
  | "expired"   // 二维码过期
  | "success"
  | "error";

interface LoginDialogProps {
  onClose: () => void;
  onLogin: (preview: string) => void;
  onToast: (message: string, tone?: "success" | "error") => void;
}

const STATUS_TEXT: Record<QrLoginStatus, string> = {
  idle: "准备登录…",
  loading: "正在生成二维码…",
  waiting: "请使用 B 站 App 扫码登录",
  scanned: "已扫码，请在手机上确认登录",
  expired: "二维码已过期，请点击刷新",
  success: "登录成功",
  error: "登录失败",
};

export function LoginDialog({ onClose, onLogin, onToast }: LoginDialogProps) {
  const [mode, setMode] = useState<"qr" | "cookie">("qr");
  const [qrStatus, setQrStatus] = useState<QrLoginStatus>("idle");
  const [qrKey, setQrKey] = useState("");
  const [qrError, setQrError] = useState("");
  const [cookie, setCookie] = useState("");
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pollTimer = useRef<number | null>(null);

  const cleanup = () => {
    if (pollTimer.current !== null) {
      window.clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  };

  const startPolling = (key: string) => {
    if (pollTimer.current !== null) window.clearTimeout(pollTimer.current);
    const poll = async () => {
      try {
        const res = await api.qrLoginPoll(key);
        if (res.loggedIn || res.status === 0) {
          cleanup();
          setQrStatus("success");
          await api.authStatus();
          // 刷新登录态 via onLogin(preview)
          const auth = await api.authStatus();
          onLogin(auth.preview);
          onToast("登录成功", "success");
          window.setTimeout(onClose, 600);
          return;
        }
        if (res.status === 86090) {
          cleanup();
          setQrStatus("expired");
          return;
        }
        if (res.status === 86102) {
          setQrStatus("scanned");
        }
        pollTimer.current = window.setTimeout(poll, 2000);
      } catch (err) {
        cleanup();
        setQrStatus("error");
        setQrError(err instanceof Error ? err.message : "轮询失败");
      }
    };
    pollTimer.current = window.setTimeout(poll, 2000);
  };

  const startQr = async () => {
    cleanup();
    setQrStatus("loading");
    setQrError("");
    try {
      const res = await api.qrLoginStart();
      setQrKey(res.qrcodeKey);
      if (canvasRef.current) {
        await QRCode.toCanvas(canvasRef.current, res.qrUrl, { width: 220, margin: 2 });
      }
      setQrStatus("waiting");
      startPolling(res.qrcodeKey);
    } catch (err) {
      setQrStatus("error");
      setQrError(err instanceof Error ? err.message : "二维码生成失败");
    }
  };

  useEffect(() => {
    void startQr();
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitCookie = async () => {
    setBusy(true);
    try {
      const auth = await api.loginWithSessdata(cookie.trim());
      onLogin(auth.preview);
      onToast("登录成功", "success");
      window.setTimeout(onClose, 500);
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Cookie 登录失败", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-backdrop" onClick={onClose}>
      <div className="login-dialog" role="dialog" aria-modal="true" aria-label="登录" onClick={(e) => e.stopPropagation()}>
        <button className="login-close" type="button" onClick={onClose} aria-label="关闭"><Icon name="close" size={18} /></button>
        <div className="login-head">
          <span className="login-brand"><Icon name="sparkles" size={18} /></span>
          <div>
            <h2>登录 B 站账号</h2>
            <p>登录后可读取稍后再看、历史等账号内容，并提升画质档位。</p>
          </div>
        </div>

        <div className="login-tabs" role="tablist">
          <button className={mode === "qr" ? "is-active" : ""} type="button" onClick={() => setMode("qr")}>扫码登录</button>
          <button className={mode === "cookie" ? "is-active" : ""} type="button" onClick={() => setMode("cookie")}>Cookie 登录</button>
        </div>

        {mode === "qr" ? (
          <div className="login-qr">
            <div className={qrStatus === "expired" || qrStatus === "error" ? "qr-mask is-warn" : "qr-mask"}>
              <canvas ref={canvasRef} width="220" height="220" />
              {qrStatus === "loading" ? <div className="qr-overlay"><span className="loading-orbit" /><span>生成中…</span></div> : null}
              {qrStatus === "expired" ? <div className="qr-overlay"><span>已过期</span><button className="text-button" type="button" onClick={() => void startQr()}>刷新二维码</button></div> : null}
              {qrStatus === "error" ? <div className="qr-overlay"><span>{qrError}</span><button className="text-button" type="button" onClick={() => void startQr()}>重试</button></div> : null}
            </div>
            <p className="login-hint">{STATUS_TEXT[qrStatus]}</p>
          </div>
        ) : (
          <div className="login-cookie">
            <label className="field">
              <span className="field-label">SESSDATA</span>
              <input value={cookie} onChange={(e) => setCookie(e.target.value)} placeholder="SESSDATA=xxx;bili_jct=xxx;…" autoComplete="off" />
            </label>
            <p className="login-hint">支持从浏览器复制 SESSDATA=xxx; bili_jct=xxx; DedeUserID=xxx; 完整 Cookie。</p>
            <button className="button button-primary" type="button" disabled={busy || !cookie.trim()} onClick={() => void submitCookie()}><Icon name="check" size={16} /> 登录</button>
          </div>
        )}
      </div>
    </div>
  );
}
