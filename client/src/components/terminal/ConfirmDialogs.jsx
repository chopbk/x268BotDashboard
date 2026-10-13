import { closePreview } from "../../trade-preview";
import PreviewBlock from "./PreviewBlock.jsx";
import { CLOSE_PERCENTS, fmt, numInput, pnlClass, qtyAtPercent } from "./format.js";
import { buildCloseAllItems, summarizeCloseAll } from "./closeAll.js";

export function CloseConfirmDialog({ confirm, busy, formError, onChange, onCancel, onSubmit }) {
  if (!confirm) return null;

  const fullQty = Number(confirm.fullQty);
  const percent = Number(confirm.percent);
  const usePercent = Number.isFinite(percent) && percent > 0 && percent <= 100;
  const closeQty = usePercent
    ? (percent === 100 ? fullQty : fullQty * (percent / 100))
    : Number(confirm.qty);
  const exitPrice = confirm.orderType === "LIMIT" ? Number(confirm.price) : Number(confirm.mark);
  const preview = closePreview({
    side: confirm.positionSide,
    entry: confirm.entry,
    exitPrice,
    qty: closeQty,
    monitors: confirm.monitors,
  });
  const percentLabel = usePercent
    ? `${percent}%`
    : (Number.isFinite(fullQty) && Number.isFinite(Number(confirm.qty)) && fullQty > 0
      ? `${fmt((Number(confirm.qty) / fullQty) * 100, 1)}%`
      : "—");

  function patch(next) {
    onChange?.({ ...confirm, ...next });
  }

  return (
    <div className="modal-backdrop term-modal" onClick={() => { if (!busy) onCancel(); }}>
      <div className="modal-card stack term-dialog" role="dialog" aria-modal="true" aria-labelledby="term-close-title" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2 id="term-close-title">Đóng vị thế</h2>
          <button type="button" disabled={busy} onClick={onCancel}>Huỷ</button>
        </header>
        <p className="muted">
          {confirm.account} · {confirm.symbol} · {confirm.positionSide}
          {" · size "}{fmt(confirm.fullQty)}
          {" · mark "}{fmt(confirm.mark)}
        </p>

        <label>
          Kiểu đóng
          <select value={confirm.orderType} disabled={busy} onChange={(e) => patch({ orderType: e.target.value })}>
            <option value="MARKET">Market</option>
            <option value="LIMIT">Limit</option>
          </select>
        </label>

        {confirm.orderType === "LIMIT" ? (
          <div className="term-tpsl-field">
            <span className="term-tpsl-label">Giá (Price)</span>
            <input
              type="text"
              inputMode="decimal"
              className="term-tpsl-input"
              disabled={busy}
              value={confirm.price ?? ""}
              placeholder="Giá limit"
              autoComplete="off"
              onChange={(e) => patch({ price: e.target.value.replace(/,/g, "") })}
            />
          </div>
        ) : (
          <p className="muted">Market: đóng theo giá thị trường (mark tham chiếu {fmt(confirm.mark)}).</p>
        )}

        <div className="term-tpsl-field">
          <span className="term-tpsl-label">Số lượng</span>
          <div className="term-tpsl-inputs">
            <input
              type="text"
              inputMode="decimal"
              className="term-tpsl-input"
              disabled={busy}
              value={confirm.qty ?? ""}
              placeholder="Qty"
              autoComplete="off"
              onChange={(e) => patch({ qty: e.target.value.replace(/,/g, ""), percent: null })}
            />
            <span className="term-close-pct-badge" title="Tỷ lệ so với size vị thế">{percentLabel}</span>
          </div>
        </div>

        <div className="term-percents" role="group" aria-label="Chọn % đóng">
          {CLOSE_PERCENTS.map((p) => (
            <button
              key={p}
              type="button"
              className={confirm.percent === p ? "active" : ""}
              disabled={busy || !Number.isFinite(fullQty)}
              onClick={() => patch({
                percent: p,
                qty: p === 100 ? numInput(fullQty) : qtyAtPercent(fullQty, p),
              })}
            >
              {p}%
            </button>
          ))}
        </div>

        <PreviewBlock preview={preview} title="Preview trước khi gửi" />
        {formError ? <p className="form-error">{formError}</p> : null}
        <p className="muted">Market gửi đóng thị trường. Limit cần giá — chưa khớp thì vị thế vẫn còn.</p>
        <div className="term-dialog-actions">
          <button type="button" className="ghost" disabled={busy} onClick={onCancel}>Giữ lệnh</button>
          <button type="button" className="term-primary" disabled={busy} onClick={onSubmit}>
            {busy ? "Đang gửi…" : `Xác nhận đóng ${confirm.orderType}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Đóng hàng loạt theo bộ lọc hiện tại: cùng % cho mỗi vị thế live.
 * confirm = { percent, orderType, itemsSourceRows } — items tính lại khi đổi %.
 */
export function CloseAllConfirmDialog({ confirm, busy, formError, onChange, onCancel, onSubmit }) {
  if (!confirm) return null;

  const percent = Number(confirm.percent) > 0 && Number(confirm.percent) <= 100
    ? Number(confirm.percent)
    : 100;
  const items = buildCloseAllItems(confirm.rows || [], percent);
  const summary = summarizeCloseAll(items);

  function patch(next) {
    onChange?.({ ...confirm, ...next });
  }

  return (
    <div className="modal-backdrop term-modal" onClick={() => { if (!busy) onCancel(); }}>
      <div className="modal-card stack term-dialog term-dialog-wide" role="dialog" aria-modal="true" aria-labelledby="term-close-all-title" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2 id="term-close-all-title">Đóng toàn bộ (bộ lọc)</h2>
          <button type="button" disabled={busy} onClick={onCancel}>Huỷ</button>
        </header>
        <p className="muted">
          {items.length} vị thế live · mỗi dòng đóng <strong>{percent}%</strong> size của chính nó.
          Paper/pending đã bỏ qua. Không đóng account ngoài bộ lọc.
        </p>

        <div className="term-percents" role="group" aria-label="Chọn % đóng mỗi vị thế">
          {CLOSE_PERCENTS.map((p) => (
            <button
              key={p}
              type="button"
              className={percent === p ? "active" : ""}
              disabled={busy}
              onClick={() => patch({ percent: p })}
            >
              {p}%
            </button>
          ))}
        </div>

        <div className="term-close-all-table-wrap">
          <table className="term-close-all-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Symbol</th>
                <th>Side</th>
                <th>Size</th>
                <th>Đóng</th>
                <th>PnL≈</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.key}>
                  <td>{item.account}</td>
                  <td>{item.symbol}</td>
                  <td className={`term-side term-side-${String(item.side).toLowerCase()}`}>{item.side}</td>
                  <td className="term-num">{fmt(item.fullQty)}</td>
                  <td className="term-num">{fmt(item.closeQty)}</td>
                  <td className={`term-num ${pnlClass(item.preview?.estimatedPnl)}`}>
                    {item.preview?.estimatedPnl == null ? "—" : fmt(item.preview.estimatedPnl, 2)}
                  </td>
                </tr>
              ))}
              {!items.length ? (
                <tr><td colSpan={6} className="muted">Không có vị thế live trong bộ lọc.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="term-preview">
          <strong>Tổng ước tính (MARKET @ mark)</strong>
          <ul>
            <li>Số lệnh: {summary.count}</li>
            <li className={pnlClass(summary.estimatedPnl)}>
              PnL dự kiến ≈ {summary.estimatedPnl == null ? "—" : fmt(summary.estimatedPnl, 2)} USDT
            </li>
            <li>Phí ước tính ≈ {summary.estimatedFee == null ? "—" : fmt(summary.estimatedFee, 4)} USDT</li>
            <li className={pnlClass(summary.netAfterFee)}>
              Net sau phí ≈ {summary.netAfterFee == null ? "—" : fmt(summary.netAfterFee, 2)} USDT
            </li>
          </ul>
        </div>

        {formError ? <p className="form-error">{formError}</p> : null}
        <p className="muted">Gửi lần lượt POSITION_CLOSE MARKET · quantityMode PERCENT/ALL. Dừng nếu một lệnh lỗi (các lệnh trước có thể đã gửi).</p>
        <div className="term-dialog-actions">
          <button type="button" className="ghost" disabled={busy} onClick={onCancel}>Giữ lệnh</button>
          <button type="button" className="term-primary" disabled={busy || !items.length} onClick={onSubmit}>
            {busy ? "Đang gửi…" : `Xác nhận đóng ${percent}% × ${items.length}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export function TpslConfirmDialog({ draft, busy, formError, onChange, onCancel, onSubmit, onCancelTrailing }) {
  if (!draft) return null;

  function patch(next) {
    onChange?.({ ...draft, ...next });
  }

  const preview = closePreview({
    side: draft.side,
    entry: draft.entry,
    exitPrice: Number(draft.tp) || Number(draft.sl) || draft.mark,
    qty: draft.qty,
    monitors: draft.monitors,
  });

  return (
    <div className="modal-backdrop term-modal" onClick={() => { if (!busy) onCancel(); }}>
      <form
        className="modal-card stack term-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="term-tpsl-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
      >
        <header>
          <h2 id="term-tpsl-title">Position TP/SL</h2>
          <button type="button" disabled={busy} onClick={onCancel}>Đóng</button>
        </header>
        <p className="muted">
          {draft.account} · {draft.symbol} · {draft.side}
          {" · entry "}{fmt(draft.entry)}
          {" · mark "}{fmt(draft.mark)}
        </p>

        <div className="term-trade-modes" role="tablist">
          <button type="button" className={draft.tab !== "trailing" ? "active" : ""} disabled={busy} onClick={() => patch({ tab: "tpsl" })}>
            Position TP/SL
          </button>
          <button type="button" className={draft.tab === "trailing" ? "active" : ""} disabled={busy} onClick={() => patch({ tab: "trailing" })}>
            Trailing Stop
          </button>
        </div>

        {draft.tab === "trailing" ? (
          <>
            <div className="term-tpsl-field">
              <span className="term-tpsl-label">Callback rate (%)</span>
              <input
                type="text"
                inputMode="decimal"
                className="term-tpsl-input"
                disabled={busy}
                value={draft.callbackRate ?? ""}
                placeholder="1.0"
                autoComplete="off"
                onChange={(e) => patch({ callbackRate: e.target.value.replace(/,/g, "") })}
              />
            </div>
            <div className="term-tpsl-field">
              <span className="term-tpsl-label">Activation price (optional)</span>
              <div className="term-tpsl-inputs">
                <input
                  type="text"
                  inputMode="decimal"
                  className="term-tpsl-input"
                  disabled={busy}
                  value={draft.activationPrice ?? ""}
                  placeholder="Trống = kích hoạt ngay"
                  autoComplete="off"
                  onChange={(e) => patch({ activationPrice: e.target.value.replace(/,/g, "") })}
                />
                <select
                  className="term-tpsl-select"
                  value={draft.trailingWorkingType || "CONTRACT_PRICE"}
                  disabled={busy}
                  aria-label="Trailing theo giá"
                  onChange={(e) => patch({ trailingWorkingType: e.target.value })}
                >
                  <option value="CONTRACT_PRICE">Last</option>
                  <option value="MARK_PRICE">Mark</option>
                </select>
              </div>
            </div>
            {draft.hasTrailing ? <p className="muted">Đang có trailing trên sàn — Confirm sẽ thay lệnh cũ.</p> : null}
          </>
        ) : (
          <>
            <div className="term-tpsl-field">
              <span className="term-tpsl-label term-tpsl-tp">Take Profit</span>
              <div className="term-tpsl-inputs">
                <input
                  type="text"
                  inputMode="decimal"
                  className="term-tpsl-input"
                  disabled={busy}
                  value={draft.tp ?? ""}
                  placeholder="Giá trigger TP"
                  autoComplete="off"
                  onChange={(e) => patch({ tp: e.target.value.replace(/,/g, ""), tpEnabled: true })}
                />
                <select
                  className="term-tpsl-select"
                  value={draft.tpWorkingType || "CONTRACT_PRICE"}
                  disabled={busy}
                  aria-label="TP theo giá"
                  onChange={(e) => patch({ tpWorkingType: e.target.value })}
                >
                  <option value="CONTRACT_PRICE">Last</option>
                  <option value="MARK_PRICE">Mark</option>
                </select>
              </div>
            </div>
            <div className="term-tpsl-field">
              <span className="term-tpsl-label term-tpsl-sl">Stop Loss</span>
              <div className="term-tpsl-inputs">
                <input
                  type="text"
                  inputMode="decimal"
                  className="term-tpsl-input"
                  disabled={busy}
                  value={draft.sl ?? ""}
                  placeholder="Giá trigger SL"
                  autoComplete="off"
                  onChange={(e) => patch({ sl: e.target.value.replace(/,/g, ""), slEnabled: true })}
                />
                <select
                  className="term-tpsl-select"
                  value={draft.slWorkingType || "CONTRACT_PRICE"}
                  disabled={busy}
                  aria-label="SL theo giá"
                  onChange={(e) => patch({ slWorkingType: e.target.value })}
                >
                  <option value="CONTRACT_PRICE">Last</option>
                  <option value="MARK_PRICE">Mark</option>
                </select>
              </div>
            </div>
            <PreviewBlock title="Preview nếu chạm TP/SL (ước tính)" preview={preview} />
            <p className="muted">Algo TAKE_PROFIT_MARKET / STOP_MARKET (closePosition). Lệnh cũ cùng loại bị hủy trước.</p>
          </>
        )}

        {formError ? <p className="form-error">{formError}</p> : null}
        <div className="term-dialog-actions">
          <button type="button" className="ghost" disabled={busy} onClick={onCancel}>Huỷ</button>
          {draft.tab === "trailing" && draft.hasTrailing ? (
            <button type="button" className="ghost" disabled={busy} onClick={onCancelTrailing}>Xóa trailing</button>
          ) : null}
          <button type="submit" className="term-primary" disabled={busy}>{busy ? "Đang gửi…" : "Confirm"}</button>
        </div>
      </form>
    </div>
  );
}

export function ReverseConfirmDialog({ confirm, busy, onCancel, onSubmit }) {
  if (!confirm) return null;
  return (
    <div className="modal-backdrop term-modal" onClick={() => { if (!busy) onCancel(); }}>
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
    <div className="modal-backdrop term-modal" onClick={() => { if (!busy) onCancel(); }}>
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

export function MonitorDraftDialog({ draft, accounts, busy, onChange, onCancel, onSubmit }) {
  if (!draft) return null;
  const envs = (accounts || []).find((a) => a.username === draft.account)?.accounts || [];
  return (
    <div className="modal-backdrop term-modal" onClick={() => { if (!busy) onCancel(); }}>
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
