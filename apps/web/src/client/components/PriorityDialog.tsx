import { useEffect, useState } from "react";
import { DEFAULT_PRIORITY, PRIORITY_TITLE, priorityLabel, type PriorityKind } from "../lib/priorityMaps";
import { Icon } from "../lib/icons";
import { t as tr } from "../lib/i18n";

/**
 * 自定义优先级弹窗 —— 对齐原版 `gui/dialog/setting/priority.py`：
 * 标题「自定义优先级」+ 提示「拖拽列表项目进行排序，越靠上优先级越高」+ 可拖拽列表，
 * 确定后写回整个数组（原版 `get_config_value()` 就是按列表当前顺序取值）。
 *
 * 触屏拖拽不可靠，所以每行另外给了 ↑/↓ 按钮（与本项目"解析列表的列配置"同一套做法）。
 */
export function PriorityDialog({
  kind, value, onClose, onConfirm,
}: {
  kind: PriorityKind | null;
  /** 当前优先级数组（弹窗打开时快照） */
  value: number[];
  onClose: () => void;
  onConfirm: (next: number[]) => void;
}) {
  const [list, setList] = useState<number[]>(value);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  // 每次换 kind 重新取快照（弹窗是"打开时快照、确定才写回"的语义）
  useEffect(() => { setList(value); }, [kind, value]);

  if (!kind) return null;

  const move = (from: number, to: number) => {
    if (to < 0 || to >= list.length || from === to) return;
    const next = [...list];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    setList(next);
  };

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal sm" role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className="modal-title">{tr("自定义优先级")}</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={tr("关闭")}><Icon name="x" size={18} /></button>
        </div>
        <div className="modal-body">
          <p className="muted small">{PRIORITY_TITLE[kind]} · 拖拽列表项目进行排序，越靠上优先级越高</p>
          <div className="col-list prio-list">
            {list.map((id, i) => (
              <div
                key={id}
                className={`col-row${dragIdx === i ? " dragging" : ""}`}
                draggable
                onDragStart={() => setDragIdx(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => { if (dragIdx !== null) move(dragIdx, i); setDragIdx(null); }}
                onDragEnd={() => setDragIdx(null)}
              >
                <span className="prio-order">{i + 1}</span>
                <span className="col-check"><span>{priorityLabel(kind, id)}</span></span>
                <span className="col-ops">
                  <button type="button" className="icon-btn sm" disabled={i === 0} onClick={() => move(i, i - 1)} title={tr("上移")} aria-label={tr("上移")}>↑</button>
                  <button type="button" className="icon-btn sm" disabled={i === list.length - 1} onClick={() => move(i, i + 1)} title={tr("下移")} aria-label={tr("下移")}>↓</button>
                </span>
              </div>
            ))}
          </div>
          <button type="button" className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => setList([...DEFAULT_PRIORITY[kind]])}>{tr("恢复默认顺序")}</button>
        </div>
        <div className="modal-foot">
          <div className="right">
            <button type="button" className="btn" onClick={onClose}>{tr("取消")}</button>
            <button type="button" className="btn primary" onClick={() => onConfirm(list)}>{tr("确定")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
