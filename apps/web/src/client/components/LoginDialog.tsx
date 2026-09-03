import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { qrLoginStart, qrLoginPoll, loginCookie } from "../services/client";
import { useAuthStore } from "../store/useAuthStore";
import { useToast } from "../lib/toast";

export function LoginDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const setAuth = useAuthStore((s) => s.set);
  const [tab, setTab] = useState<"qr" | "cookie">("qr");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [qrStatus, setQrStatus] = useState("");
  const [cookieVal, setCookieVal] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTab("qr");
    setCookieVal("");
    let poll: ReturnType<typeof setInterval> | undefined;
    const start = async () => {
      try {
        const s = await qrLoginStart();
        setQrStatus(qrStatusText(s.status));
        const dataUrl = await QRCode.toDataURL(s.qrUrl, { width: 160, margin: 1 });
        setQrDataUrl(dataUrl);
        poll = setInterval(async () => {
          try {
            const r = await qrLoginPoll(s.qrcodeKey);
            setQrStatus(qrStatusText(r.status, r.loggedIn));
            if (r.loggedIn) {
              clearInterval(poll);
              setAuth(true, "");
              void useAuthStore.getState().refresh();
              toast("扫码登录成功", "ok");
              onClose();
            }
          } catch { /* 忽略单次轮询错误 */ }
        }, 1500);
      } catch {
        setQrStatus("二维码生成失败");
        toast("扫码登录暂不可用", "warn");
      }
    };
    void start();
    return () => { if (poll) clearInterval(poll); };
  }, [open]);

  if (!open) return null;

  const doCookie = async () => {
    const v = cookieVal.trim();
    if (!v) { toast("请输入 SESSDATA", "warn"); return; }
    setSubmitting(true);
    try {
      const st = await loginCookie(v);
      setAuth(st.loggedIn, st.preview);
      void useAuthStore.getState().refresh();
      toast("已登录，Cookie 有效", "ok");
      onClose();
    } catch (e) {
      toast("登录失败：" + (e instanceof Error ? e.message : String(e)), "err");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="overlay sheet-on-mobile center-mobile" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal sm login-modal">
        <div className="modal-head">
          <div className="modal-title">登录</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            <svg className="ico" viewBox="0 0 24 24" width={18} height={18}><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="login-tabs">
          <button className={`login-tab${tab === "qr" ? " active" : ""}`} onClick={() => setTab("qr")}>扫码登录</button>
          <button className={`login-tab${tab === "cookie" ? " active" : ""}`} onClick={() => setTab("cookie")}>Cookie 登录</button>
        </div>
        <div className="modal-body login-body">
          {tab === "qr" ? (
            <div className="qr-pane">
              <div className="qr-box">
                {qrDataUrl ? <img src={qrDataUrl} alt="扫码" width={150} height={150} /> : <div className="qr-placeholder"><span className="spinner" /></div>}
              </div>
              <div className="scan-status">{qrStatus || "用 B 站 App 扫码"}</div>
              <div className="auth-tip">登录后可访问历史记录 / 稍后再看 / 收藏夹与高质量内容</div>
            </div>
          ) : (
            <div className="cookie-pane">
              <div className="field-label">SESSDATA</div>
              <textarea className="text-input cookie-input" rows={4} value={cookieVal} placeholder="SESSDATA=...;bili_jct=..." onChange={(e) => setCookieVal(e.target.value)} />
              <div className="auth-tip">支持分号或 JSON 格式，校验通过后关闭弹窗</div>
              <div className="modal-foot">
                <div className="right">
                  <button type="button" className="btn primary" disabled={submitting} onClick={doCookie}>{submitting ? "校验中…" : "登录"}</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function qrStatusText(status: number, loggedIn?: boolean): string {
  if (loggedIn) return "登录成功";
  switch (status) {
    case 86101: return "等待扫码…";
    case 86102: return "已扫码，等待确认…";
    case 86103: return "二维码已过期";
    case 86090: return "已确认，登录中…";
    default: return "等待扫码…";
  }
}