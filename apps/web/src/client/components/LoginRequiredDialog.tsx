import { Icon } from "../lib/icons";
import { t as tr } from "../lib/i18n";
import { Overlay } from "./Overlay";

/**
 * 未登录提示（对齐原版 `main_window.py:310-321` 的 MessageBox）。
 *
 * 原版行为：未登录/登录态过期时点导航「收藏夹」→ 弹 `Login Required`=需要登录 /
 * `Please log in to your account first.`=请先登录账号，**并把导航项复位**。
 * Web 端没有"导航项卡住"的问题，所以复位不用做；但要给出**去登录**的入口，
 * 而不是像之前那样把浮层打开、里面显示一句错误。
 */
export function LoginRequiredDialog({ open, onClose, onLogin }: {
  open: boolean; onClose: () => void; onLogin: () => void;
}) {
  return (
    <Overlay open={open} onClose={onClose} size="sm" centerOnMobile>
        <div className="modal-head">
          <div className="modal-title">{tr("需要登录")}</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={tr("关闭")}><Icon name="x" size={18} /></button>
        </div>
        <div className="modal-body">
          <p>{tr("请先登录账号。")}</p>
        </div>
        <div className="modal-foot">
          <div className="right">
            <button type="button" className="btn" onClick={onClose}>{tr("取消")}</button>
            <button type="button" className="btn primary" onClick={onLogin}>{tr("登录")}</button>
          </div>
        </div>
      </Overlay>
  );
}
