import { useState } from "react";
import { t as tr } from "../lib/i18n";
import { Overlay } from "./Overlay";

/**
 * 「检测到重复下载」对话框（原版 `gui/dialog/misc/duplicate_download.py`）。
 *
 * 原版是**逐条询问**的阻塞式弹窗（`task/manager.py:561-571`：每条重复项弹一次，
 * 后台线程 `done_event.wait()` 等用户点），文案：
 *   标题「检测到重复下载」
 *   正文「检测到下载列表中已存在相同的下载任务，是否继续下载？」
 *   任务名称：{title}
 *   复选框「不再询问」（勾了就把全局重复策略改成 继续下载/跳过下载，`duplicate_download.py:49-53`）
 *   按钮「继续下载」/「跳过下载」
 *
 * Web 侧改成同一个弹窗**排队逐条问**（一次一条），勾「不再询问」后剩下的按同一决定批量处理 ——
 * 语义与原版一致，又不需要阻塞线程。父组件用 `key={itemId}` 渲染，换下一条时组件重挂，
 * 「不再询问」自然回到未勾选（等同原版每次都新建弹窗）。
 */
export function DuplicateDialog({ open, duplicate, remaining, onContinue, onSkip }: {
  /** 由父组件传开关（**不再用 `&&` 门控组件挂载**）：只有这样关闭时 Overlay 才播得到退场动画 */
  open: boolean;
  /** 当前这一条 */
  duplicate: { itemId: string; title: string };
  /** 队列里还剩几条（含当前这条）—— 原版没有这个计数，是我们给队列加的一行小字 */
  remaining: number;
  onContinue: (neverAsk: boolean) => void;
  onSkip: (neverAsk: boolean) => void;
}) {
  const [neverAsk, setNeverAsk] = useState(false);
  return (
    <Overlay open={open} dismissable={false} size="sm" sheetOnMobile centerOnMobile>
        <div className="modal-head">
          <div className="modal-title">{tr("检测到重复下载")}</div>
        </div>
        <div className="modal-body">
          <p className="small">{tr("检测到下载列表中已存在相同的下载任务，是否继续下载？")}</p>
          <p className="small" style={{ marginTop: 6 }}>任务名称：{duplicate.title}</p>
          {remaining > 1 ? <p className="muted small" style={{ marginTop: 6 }}>还有 {remaining - 1} 条重复项待确认。</p> : null}
          <label className="check-row" style={{ marginTop: 10 }}>
            <input type="checkbox" checked={neverAsk} onChange={(e) => setNeverAsk(e.target.checked)} />
            <span>{tr("不再询问")}</span>
          </label>
        </div>
        <div className="modal-foot">
          <div className="right">
            <button type="button" className="btn" onClick={() => onSkip(neverAsk)}>{tr("跳过下载")}</button>
            <button type="button" className="btn primary" onClick={() => onContinue(neverAsk)}>{tr("继续下载")}</button>
          </div>
        </div>
      </Overlay>
  );
}
