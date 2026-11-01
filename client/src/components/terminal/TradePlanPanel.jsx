import { useEffect, useState } from "react";
import { api } from "../../api";

/**
 * Trade plan draft + server preview. Drag chart chỉ patch plan/draft.
 */
export default function TradePlanPanel({
  market,
  account,
  draft,
  onDraftChange,
  plan,
  onPlanChange,
  preview,
  onPreviewChange,
  canPreview,
  protection,
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const symbol = market?.symbol || draft?.symbol || "";

  useEffect(() => {
    onPreviewChange?.(null);
  }, [
    account,
    symbol,
    draft?.quantity,
    draft?.stopLoss,
    draft?.takeProfit,
    draft?.entryPrice,
    draft?.entryType,
    draft?.positionSide,
  ]); // eslint-disable-line react-hooks/exhaustive-deps -- invalidate preview khi đổi field

  async function savePlan() {
    if (!symbol) {
      setError("Chọn symbol");
      return;
    }
    setBusy(true);
    setError("");
    try {
      let next;
      if (plan?.id) {
        const res = await api(`/api/terminal/plans/${plan.id}`, {
          method: "PATCH",
          body: {
            expectedRevision: plan.planRevision,
            target: {
              username: account || undefined,
              symbol,
              instrumentId: market?.instrumentId || symbol,
              exchange: market?.exchange || "binance",
              marketType: market?.marketType || "usdt_perp_linear",
              positionSide: draft.positionSide || "LONG",
            },
            thesis: draft.thesis || "",
            entryType: draft.entryType || "MARKET",
            entryPrice: draft.entryPrice || undefined,
            stopLoss: draft.stopLoss || undefined,
            takeProfit: draft.takeProfit || undefined,
            quantity: draft.quantity || undefined,
            timeframe: draft.timeframe || "15m",
            signalEventId: draft.signalEventId || undefined,
          },
        });
        next = res.plan;
      } else {
        const res = await api("/api/terminal/plans", {
          method: "POST",
          body: {
            target: {
              username: account || undefined,
              symbol,
              instrumentId: market?.instrumentId || symbol,
              exchange: market?.exchange || "binance",
              marketType: market?.marketType || "usdt_perp_linear",
              positionSide: draft.positionSide || "LONG",
            },
            thesis: draft.thesis || "",
            entryType: draft.entryType || "MARKET",
            entryPrice: draft.entryPrice || undefined,
            stopLoss: draft.stopLoss || undefined,
            takeProfit: draft.takeProfit || undefined,
            quantity: draft.quantity || undefined,
            timeframe: draft.timeframe || "15m",
            signalEventId: draft.signalEventId || undefined,
          },
        });
        next = res.plan;
      }
      onPlanChange?.(next);
      onDraftChange?.({ ...draft, planId: next.id });
      return next;
    } catch (err) {
      setError(err.message || "Không lưu plan");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function runPreview() {
    if (!canPreview) {
      setError("Thiếu quyền đặt lệnh / mở vị thế");
      return;
    }
    if (!account || !symbol) {
      setError("Cần tài khoản và symbol");
      return;
    }
    if (!(Number(draft.quantity) > 0)) {
      setError("Quantity > 0");
      return;
    }
    setBusy(true);
    setError("");
    try {
      let activePlan = plan;
      if (!activePlan?.id) {
        activePlan = await savePlan();
        if (!activePlan?.id) return;
        setBusy(true);
      }
      const res = await api("/api/trading/preview", {
        method: "POST",
        body: {
          action: "ORDER_CREATE",
          username: account,
          symbol,
          instrumentId: market?.instrumentId || symbol,
          exchange: market?.exchange || "binance",
          side: (draft.positionSide || "LONG") === "SHORT" ? "SELL" : "BUY",
          positionSide: draft.positionSide || "LONG",
          type: draft.entryType || "MARKET",
          quantity: String(draft.quantity),
          price: draft.entryPrice || undefined,
          stopLoss: draft.stopLoss || undefined,
          takeProfit: draft.takeProfit || undefined,
          planId: activePlan.id,
          expectedPlanRevision: activePlan.planRevision,
        },
      });
      onPreviewChange?.(res.preview);
    } catch (err) {
      setError(err.message || "Preview thất bại");
      onPreviewChange?.(null);
    } finally {
      setBusy(false);
    }
  }

  function setField(key, value) {
    onDraftChange?.({ ...draft, [key]: value });
  }

  return (
    <div className="term-plan-panel">
      <header className="term-plan-head">
        <strong>Trade plan</strong>
        {plan?.planRevision != null ? <span className="muted">rev {plan.planRevision}</span> : null}
      </header>
      <label>
        Thesis
        <textarea
          rows={2}
          value={draft.thesis || ""}
          onChange={(e) => setField("thesis", e.target.value)}
          placeholder="Lý do vào lệnh"
        />
      </label>
      <div className="term-plan-grid">
        <label>
          Side
          <select value={draft.positionSide || "LONG"} onChange={(e) => setField("positionSide", e.target.value)}>
            <option value="LONG">LONG</option>
            <option value="SHORT">SHORT</option>
          </select>
        </label>
        <label>
          Entry
          <select value={draft.entryType || "MARKET"} onChange={(e) => setField("entryType", e.target.value)}>
            <option value="MARKET">Market</option>
            <option value="LIMIT">Limit</option>
          </select>
        </label>
        <label>
          Giá entry
          <input value={draft.entryPrice || ""} onChange={(e) => setField("entryPrice", e.target.value)} inputMode="decimal" />
        </label>
        <label>
          Qty
          <input value={draft.quantity || ""} onChange={(e) => setField("quantity", e.target.value)} inputMode="decimal" />
        </label>
        <label>
          SL
          <input value={draft.stopLoss || ""} onChange={(e) => setField("stopLoss", e.target.value)} inputMode="decimal" />
        </label>
        <label>
          TP
          <input value={draft.takeProfit || ""} onChange={(e) => setField("takeProfit", e.target.value)} inputMode="decimal" />
        </label>
      </div>
      {preview ? (
        <div className="term-plan-preview">
          <p>
            Preview <code>{preview.previewId.slice(0, 8)}</code>
            {" · "}
            {preview.quote?.quality || "?"}
            {" · hết hạn "}
            {preview.expiresAt ? new Date(preview.expiresAt).toLocaleTimeString() : "—"}
          </p>
          <p className="muted">
            Notional ≈ {preview.sizing?.notional != null ? Number(preview.sizing.notional).toFixed(2) : "—"} ·
            Risk@SL {preview.risk?.incomplete ? "unknown" : preview.risk?.riskAtStop?.toFixed?.(2) ?? preview.risk?.riskAtStop ?? "—"}
          </p>
          {preview.capability?.bracketAtomic === false ? (
            <p className="term-warn-text">Bracket không atomic — sau entry sẽ hiện protection pending.</p>
          ) : null}
        </div>
      ) : (
        <p className="muted">Chưa có preview hợp lệ. Đổi account/size/SL làm mất preview cũ.</p>
      )}
      {protection?.status ? (
        <p className={`term-protect-banner term-protect-${protection.status}`}>
          Bảo vệ: {protection.status.replaceAll("_", " ")}
          {protection.stopLoss ? ` · SL ${protection.stopLoss}` : ""}
          {protection.takeProfit ? ` · TP ${protection.takeProfit}` : ""}
        </p>
      ) : null}
      {error ? <p className="form-error">{error}</p> : null}
      <div className="term-plan-actions">
        <button type="button" className="ghost" disabled={busy} onClick={savePlan}>Lưu plan</button>
        <button type="button" disabled={busy || !canPreview} onClick={runPreview}>Preview</button>
      </div>
    </div>
  );
}
