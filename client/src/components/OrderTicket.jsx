import { useEffect, useMemo, useState } from "react";
import { api } from "../api";

const TYPES = [
  { id: "MARKET", label: "Market" },
  { id: "LIMIT", label: "Limit" },
  { id: "STOP_MARKET", label: "Stop" },
  { id: "STOP", label: "Stop Limit" },
];

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function fmt(value, digits = 4) {
  const n = num(value);
  if (n == null) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

/**
 * Khung đặt lệnh kiểu Binance Futures: Buy/Sell, Market/Limit/Stop, hedge side.
 */
export default function OrderTicket({ accounts = [], defaultAccount = "", onPlaced, canCreate }) {
  const [account, setAccount] = useState(defaultAccount || accounts[0]?.username || "");
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [side, setSide] = useState("BUY");
  const [positionSide, setPositionSide] = useState("LONG");
  const [type, setType] = useState("LIMIT");
  const [price, setPrice] = useState("");
  const [triggerPrice, setTriggerPrice] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reduceOnly, setReduceOnly] = useState(false);
  const [mark, setMark] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState(null);

  useEffect(() => {
    if (!defaultAccount) return;
    setAccount(defaultAccount);
  }, [defaultAccount]);

  useEffect(() => {
    const sym = String(symbol || "").trim().toUpperCase();
    if (!sym || sym.length < 4) {
      setMark(null);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const data = await api(`/api/orders/mark?symbol=${encodeURIComponent(sym)}`);
        if (cancelled) return;
        setMark(data.mark);
        if (data.mark != null && type === "LIMIT" && !price) {
          setPrice(String(data.mark));
        }
        if (data.mark != null && (type === "STOP" || type === "STOP_MARKET") && !triggerPrice) {
          setTriggerPrice(String(data.mark));
        }
      } catch (err) {
        if (!cancelled) console.warn("[OrderTicket]", err.message);
      }
    }, 280);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [symbol, type]); // eslint-disable-line react-hooks/exhaustive-deps -- chỉ refetch khi symbol/type đổi

  const notional = useMemo(() => {
    const qty = num(quantity);
    const px = num(type === "MARKET" ? mark : (price || triggerPrice || mark));
    if (qty == null || px == null) return null;
    return qty * px;
  }, [quantity, price, triggerPrice, mark, type]);

  function applyMark() {
    if (mark == null) return;
    if (type === "LIMIT") setPrice(String(mark));
    else if (type === "STOP" || type === "STOP_MARKET") setTriggerPrice(String(mark));
  }

  function syncHedge(nextSide) {
    setSide(nextSide);
    setPositionSide(nextSide === "BUY" ? "LONG" : "SHORT");
  }

  function askPlace() {
    if (!canCreate) {
      setError("Thiếu quyền orders.create");
      return;
    }
    const sym = String(symbol || "").trim().toUpperCase();
    if (!account) {
      setError("Chọn tài khoản");
      return;
    }
    if (!sym) {
      setError("Nhập symbol");
      return;
    }
    if (!(num(quantity) > 0)) {
      setError("Quantity phải > 0");
      return;
    }
    if (type === "LIMIT" && !(num(price) > 0)) {
      setError("Limit cần giá");
      return;
    }
    if ((type === "STOP" || type === "STOP_MARKET") && !(num(triggerPrice) > 0)) {
      setError("Stop cần trigger");
      return;
    }
    if (type === "STOP" && !(num(price) > 0)) {
      setError("Stop Limit cần giá limit");
      return;
    }
    setError("");
    setConfirm({
      account,
      symbol: sym,
      side,
      positionSide,
      type,
      quantity: String(quantity),
      price: price ? String(price) : undefined,
      triggerPrice: triggerPrice ? String(triggerPrice) : undefined,
      reduceOnly,
    });
  }

  async function submitPlace() {
    if (!confirm || busy) return;
    setBusy(true);
    try {
      const body = {
        username: confirm.account,
        symbol: confirm.symbol,
        side: confirm.side,
        positionSide: confirm.positionSide,
        type: confirm.type,
        quantity: confirm.quantity,
        reduceOnly: confirm.reduceOnly,
      };
      if (confirm.type === "LIMIT") body.price = confirm.price;
      if (confirm.type === "STOP" || confirm.type === "STOP_MARKET") {
        body.triggerPrice = confirm.triggerPrice;
        if (confirm.type === "STOP") body.price = confirm.price;
        else body.price = confirm.triggerPrice;
      }
      const result = await api("/api/trading/orders", { method: "POST", body });
      const orderId = result?.command?.result?.orderId || result?.command?.result?.algoId;
      setNote(
        result?.duplicate
          ? `Trùng request trước · ${confirm.symbol}`
          : `Đã đặt ${confirm.type} ${confirm.side} ${confirm.symbol} ${confirm.positionSide}${orderId ? ` · #${orderId}` : ""}`
      );
      setConfirm(null);
      setError("");
      onPlaced?.(result);
    } catch (err) {
      console.error("[OrderTicket]", err);
      setError(err.message || "Không đặt được lệnh");
    } finally {
      setBusy(false);
    }
  }

  if (!canCreate) {
    return (
      <aside className="order-ticket order-ticket-locked">
        <p className="muted">Cần quyền <code>orders.create</code> để đặt lệnh.</p>
      </aside>
    );
  }

  return (
    <aside className="order-ticket">
      <header className="order-ticket-head">
        <h2>Đặt lệnh</h2>
        <div className="order-ticket-mark">
          <span className="muted">Mark</span>
          <strong>{fmt(mark, 6)}</strong>
          <button type="button" className="ghost order-ticket-mark-btn" disabled={mark == null} onClick={applyMark} title="Điền mark vào giá">
            Dùng mark
          </button>
        </div>
      </header>

      <div className="order-ticket-grid">
        <label>
          Tài khoản
          <select value={account} onChange={(e) => setAccount(e.target.value)}>
            {!account ? <option value="">Chọn…</option> : null}
            {accounts.map((item) => (
              <option key={item.username} value={item.username}>{item.username}</option>
            ))}
          </select>
        </label>
        <label>
          Symbol
          <input
            value={symbol}
            spellCheck={false}
            onChange={(e) => setSymbol(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
            placeholder="BTCUSDT"
          />
        </label>
      </div>

      <div className="order-ticket-sides" role="group" aria-label="Buy hoặc Sell">
        <button type="button" className={`order-side-buy ${side === "BUY" ? "active" : ""}`} onClick={() => syncHedge("BUY")}>
          Buy / Long
        </button>
        <button type="button" className={`order-side-sell ${side === "SELL" ? "active" : ""}`} onClick={() => syncHedge("SELL")}>
          Sell / Short
        </button>
      </div>

      <div className="order-ticket-types" role="tablist" aria-label="Loại lệnh">
        {TYPES.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={type === item.id}
            className={type === item.id ? "active" : ""}
            onClick={() => setType(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <label className="order-ticket-field">
        Position side (hedge)
        <select value={positionSide} onChange={(e) => setPositionSide(e.target.value)}>
          <option value="LONG">LONG</option>
          <option value="SHORT">SHORT</option>
          <option value="BOTH">BOTH (one-way)</option>
        </select>
      </label>

      {(type === "STOP" || type === "STOP_MARKET") ? (
        <label className="order-ticket-field">
          Trigger
          <input inputMode="decimal" value={triggerPrice} onChange={(e) => setTriggerPrice(e.target.value)} placeholder="Giá kích hoạt" />
        </label>
      ) : null}

      {(type === "LIMIT" || type === "STOP") ? (
        <label className="order-ticket-field">
          Giá
          <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Limit price" />
        </label>
      ) : null}

      <label className="order-ticket-field">
        Số lượng
        <input inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="Qty" />
      </label>

      <label className="order-ticket-check">
        <input type="checkbox" checked={reduceOnly} onChange={(e) => setReduceOnly(e.target.checked)} />
        Reduce-only (chỉ giảm vị thế)
      </label>

      <div className="order-ticket-meta">
        <span>Notional ≈ <strong>{fmt(notional, 2)}</strong> USDT</span>
        <span className="muted">{side} · {positionSide} · {type}</span>
      </div>

      {error ? <p className="form-error">{error}</p> : null}
      {note ? <p className="form-ok">{note}</p> : null}

      <button
        type="button"
        className={`order-ticket-submit ${side === "BUY" ? "buy" : "sell"}`}
        disabled={busy}
        onClick={askPlace}
      >
        {busy ? "Đang gửi…" : side === "BUY" ? `Buy ${symbol || ""}` : `Sell ${symbol || ""}`}
      </button>

      {confirm ? (
        <div className="modal-backdrop" role="presentation" onClick={() => !busy && setConfirm(null)}>
          <div className="modal-card stack order-ticket-confirm" role="dialog" aria-modal="true" aria-labelledby="order-confirm-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="order-confirm-title">Xác nhận đặt lệnh</h2>
            <dl className="order-ticket-confirm-dl">
              <dt>Tài khoản</dt><dd>{confirm.account}</dd>
              <dt>Symbol</dt><dd>{confirm.symbol}</dd>
              <dt>Lệnh</dt><dd>{confirm.side} · {confirm.positionSide} · {confirm.type}</dd>
              <dt>Qty</dt><dd>{confirm.quantity}</dd>
              {confirm.price ? <><dt>Giá</dt><dd>{confirm.price}</dd></> : null}
              {confirm.triggerPrice ? <><dt>Trigger</dt><dd>{confirm.triggerPrice}</dd></> : null}
              <dt>Reduce-only</dt><dd>{confirm.reduceOnly ? "Có" : "Không"}</dd>
              <dt>Ước tính</dt><dd>{fmt(notional, 2)} USDT</dd>
            </dl>
            <div className="modal-actions">
              <button type="button" className="ghost" disabled={busy} onClick={() => setConfirm(null)}>Huỷ</button>
              <button type="button" className={`order-ticket-submit ${confirm.side === "BUY" ? "buy" : "sell"}`} disabled={busy} onClick={submitPlace}>
                {busy ? "Đang gửi…" : "Xác nhận"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
