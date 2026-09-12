import { Icon } from "../lib/icons";
import { t as tr } from "../lib/i18n";
import { Overlay } from "./Overlay";

/**
 * 账号卡片。
 *
 * 对齐原版 `ProfileCard`：头像/昵称/UID + 「打开 B 站主页」+「退出登录」。
 * 原版挂在导航栏底部的头像控件上（`NavigationLargeAvatarWidget`）。
 */
export function ProfileDialog({ open, onClose, uname, face, mid, preview, onLogout }: {
  open: boolean; onClose: () => void; uname?: string; face?: string; mid?: number; preview?: string; onLogout: () => void;
}) {
  const fallback = (el: HTMLImageElement) => { el.style.display = "none"; const p = el.parentElement; if (p) p.textContent = (uname?.charAt(0) || "用"); };
  return (
    <Overlay open={open} onClose={onClose} size="sm" sheetOnMobile centerOnMobile>
        <div className="modal-head">
          <div className="modal-title">{tr("账号")}</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={tr("关闭")}><Icon name="x" size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="profile-row">
            <span className="avatar profile-avatar">
              {face ? <img className="avatar-img" src={face} alt="" referrerPolicy="no-referrer" width={48} height={48} onError={(e) => fallback(e.currentTarget)} /> : null}
              {face ? null : (uname?.charAt(0) || "用")}
            </span>
            <div className="profile-meta">
              <div className="profile-uname">{uname || "已登录"}</div>
              <div className="muted small">{mid ? "UID " + mid : preview ? tr("已登录") : ""}</div>
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onLogout}>{tr("退出登录")}</button>
          <div className="right">
            {mid ? (
              <a className="btn" href={"https://space.bilibili.com/" + mid} target="_blank" rel="noreferrer" onClick={onClose}>打开 B 站主页</a>
            ) : null}
            <button type="button" className="btn" onClick={onClose}>{tr("关闭")}</button>
          </div>
        </div>
      </Overlay>
  );
}
