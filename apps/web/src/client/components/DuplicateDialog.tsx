
export function DuplicateDialog({
  open, onClose, duplicates, onForce,
}: {
  open: boolean; onClose: () => void;
  duplicates: Array<{ itemId: string; title: string }>;
  onForce: (dupIds: string[]) => void;
}) {
  if (!open || duplicates.length === 0) return null;
  return (
    <div className="overlay sheet-on-mobile center-mobile" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal sm">
        <div className="modal-head">
          <div className="modal-title">重复下载</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            <svg className="ico" viewBox="0 0 24 24" width={18} height={18}><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="modal-body">
          <p className="small muted" style={{ marginBottom: 10 }}>以下内容已下载过：</p>
          <div className="dup-list">
            {duplicates.slice(0, 8).map((d) => (
              <div key={d.itemId} className="dup-item">
                <span className="dup-dot" />{d.title}
              </div>
            ))}
            {duplicates.length > 8 && <div className="dup-item muted">…共 {duplicates.length} 个</div>}
          </div>
        </div>
        <div className="modal-foot">
          <div className="right">
            <button type="button" className="btn" onClick={onClose}>取消</button>
            <button type="button" className="btn" onClick={onClose}>跳过重复</button>
            <button type="button" className="btn primary" onClick={() => onForce(duplicates.map((d) => d.itemId))}>强制下载 {duplicates.length} 个</button>
          </div>
        </div>
      </div>
    </div>
  );
}