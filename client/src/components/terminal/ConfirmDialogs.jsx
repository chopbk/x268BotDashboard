import PreviewBlock from "./PreviewBlock.jsx";
import { fmt } from "./format.js";

export function CloseConfirmDialog({ confirm, busy, onCancel, onSubmit }) {
  if (!confirm) return null;
  return (
    <div className="modal-backdrop" onClick={() => { if (!busy) onCancel(); }}>
      <div className="modal-card stack term-dialog" role="dialog" aria-modal="true" aria-labelledby="term-close-title" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2 id="term-close-title">Xác nhận đóng vị thế</h2>
          <button type="button" disabled={busy} onClick={onCancel}>Huỷ</button>
        </header>
        <p>
          Đóng {confirm.orderType} {confirm.symbol} {confirm.positionSide} · {confirm.account}
          {confirm.orderType === "LIMIT" ? ` @ ${confirm.price}` : " (thị trường)"}
          {confirm.quantityMode === "PERCENT"
            ? ` · ${confirm.percent}%`
            : confirm.quantityMode === "ALL"
              ? " · 100%"
              : ` · qty ${confirm.quantity}`}
        </p>
        <PreviewBlock preview={confirm.preview} title="Preview trước khi gửi" />
        <p className="muted">Gửi thành công không đồng nghĩa đã khớp. Limit chưa khớp thì vị thế vẫn còn.</p>
        <div className="term-dialog-actions">
          <button type="button" className="ghost" disabled={busy} onClick={onCancel}>Giữ lệnh</button>
          <button type="button" className="term-primary" disabled={busy} onClick={onSubmit}>{busy ? "Đang gửi…" : "Xác nhận đóng"}</button>
        </div>
      </div>
    </div>
  );
}

export function ReverseConfirmDialog({ confirm, busy, onCancel, onSubmit }) {
  if (!confirm) return null;
  return (
    <div className="modal-backdrop" onClick={() => { if (!busy) onCancel(); }}>
      <div className="modal-card stack term-dialog" role="dialog" aria-modal="true" aria-labelledby="term-rev-title" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2 id="term-rev-title">Xác nhận đảo chiều</h2>
          <button type="button" disabled={busy} onClick={onCancel}>Huỷ</button>
        </header>
        <p>
          {confirm.account} · {confirm.symbol}: {confirm.positionSide} → {confirm.newSide}
          <br />
          Bước 1 đóng MARKET → bước 2 mở MARKET qty {confirm.quantity}
        </p>
        <PreviewBlock preview={confirm.preview} title="Bước 1 — đóng" />
        <PreviewBlock preview={confirm.openPreview} title="Bước 2 — mở đối ứng" />
        <p className="muted">Nếu bước mở lỗi sau khi đóng: vị thế có thể flat — không tự mở lại phía cũ.</p>
        <div className="term-dialog-actions">
          <button type="button" className="ghost" disabled={busy} onClick={onCancel}>Giữ lệnh</button>
          <button type="button" className="term-primary" disabled={busy} onClick={onSubmit}>{busy ? "Đang gửi…" : "Xác nhận đảo chiều"}</button>
        </div>
      </div>
    </div>
  );
}

export function OpenConfirmDialog({ confirm, busy, onCancel, onSubmit }) {
  if (!confirm) return null;
  return (
    <div className="modal-backdrop" onClick={() => { if (!busy) onCancel(); }}>
      <div className="modal-card stack term-dialog" role="dialog" aria-modal="true" aria-labelledby="term-open-title" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2 id="term-open-title">Xác nhận mở vị thế</h2>
          <button type="button" disabled={busy} onClick={onCancel}>Huỷ</button>
        </header>
        <p>
          Mở {confirm.orderType} {confirm.symbol} {confirm.side} · {confirm.account}
          {confirm.orderType === "LIMIT" ? ` @ ${confirm.price}` : ""} · qty {confirm.quantity}
        </p>
        <PreviewBlock preview={confirm.preview} title="Preview" />
        <div className="term-dialog-actions">
          <button type="button" className="ghost" disabled={busy} onClick={onCancel}>Huỷ</button>
          <button type="button" className="term-primary" disabled={busy} onClick={onSubmit}>{busy ? "Đang gửi…" : "Confirm mở"}</button>
        </div>
      </div>
    </div>
  );
}

export function TpslConfirmDialog({ draft, busy, onCancel, onSubmit, onCancelTrailing }) {
  if (!draft) return null;
  return (
    <div className="modal-backdrop" onClick={() => { if (!busy) onCancel(); }}>
      <form
        className="modal-card stack term-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="term-tpsl-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
      >
        <header>
          <h2 id="term-tpsl-title">Xác nhận bảo vệ</h2>
          <button type="button" disabled={busy} onClick={onCancel}>Huỷ</button>
        </header>
        <p className="muted">
          {draft.account} · {draft.symbol} · {draft.side}
          {" · entry "}{fmt(draft.entry)} · mark {fmt(draft.mark)}
        </p>
        {draft.tab === "trailing" ? (
          <p>Trailing callback {draft.callbackRate}%{draft.activationPrice ? ` · activation ${draft.activationPrice}` : ""}</p>
        ) : (
          <p>TP {draft.tp || "—"} · SL {draft.sl || "—"}</p>
        )}
        <div className="term-dialog-actions">
          {draft.tab === "trailing" && draft.hasTrailing ? (
            <button type="button" className="ghost" disabled={busy} onClick={onCancelTrailing}>Xóa trailing</button>
          ) : null}
          <button type="button" className="ghost" disabled={busy} onClick={onCancel}>Huỷ</button>
          <button type="submit" className="term-primary" disabled={busy}>{busy ? "Đang gửi…" : "Confirm"}</button>
        </div>
      </form>
    </div>
  );
}

export function MonitorDraftDialog({ draft, accounts, busy, onChange, onCancel, onSubmit }) {
  if (!draft) return null;
  const envs = (accounts || []).find((a) => a.username === draft.account)?.accounts || [];
  return (
    <div className="modal-backdrop" onClick={() => { if (!busy) onCancel(); }}>
      <form
        className="modal-card stack term-dialog"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
      >
        <header>
          <h2>Thêm monitor</h2>
          <button type="button" disabled={busy} onClick={onCancel}>Đóng</button>
        </header>
        <p className="muted">Tạo bản ghi monitor — không mở/đóng vị thế sàn.</p>
        <label>Tài khoản
          <select value={draft.account} required onChange={(e) => onChange({ ...draft, account: e.target.value, env: "" })}>
            <option value="">Chọn</option>
            {(accounts || []).map((a) => <option key={a.username} value={a.username}>{a.username}</option>)}
          </select>
        </label>
        <label>Config
          <select value={draft.env} required onChange={(e) => onChange({ ...draft, env: e.target.value })}>
            <option value="">Chọn</option>
            {envs.map((env) => <option key={env} value={env}>{env}</option>)}
          </select>
        </label>
        <label>Symbol
          <input value={draft.symbol} required onChange={(e) => onChange({ ...draft, symbol: e.target.value.toUpperCase() })} />
        </label>
        <label>Side
          <select value={draft.side} onChange={(e) => onChange({ ...draft, side: e.target.value })}>
            <option value="LONG">LONG</option>
            <option value="SHORT">SHORT</option>
          </select>
        </label>
        <label>Signal
          <input value={draft.signal} onChange={(e) => onChange({ ...draft, signal: e.target.value })} />
        </label>
        <button type="submit" className="term-primary" disabled={busy}>{busy ? "Đang lưu…" : "Thêm monitor"}</button>
      </form>
    </div>
  );
}
