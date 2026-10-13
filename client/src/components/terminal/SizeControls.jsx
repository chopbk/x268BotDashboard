import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { CLOSE_PERCENTS } from "./format.js";
import { OPEN_PERCENTS, SIZE_MODES, estimateSize, sizeHint } from "./sizing.js";

/**
 * Điều khiển size: Qty | % ví | USDT | Rủi ro $.
 * onChange chỉ khi user thao tác; kèm estimate + balance hiện tại.
 */
export default function SizeControls({
  account,
  env,
  price,
  leverage,
  stop,
  disabled,
  value,
  onChange,
  presets = "open",
}) {
  const form = value || { sizeMode: "qty", quantity: "", percent: "", usdt: "", riskBudget: "", stop: "" };
  const [balance, setBalance] = useState(null);
  const [balError, setBalError] = useState("");

  useEffect(() => {
    if (!account || form.sizeMode === "qty") {
      setBalance(null);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const q = new URLSearchParams({ account });
        if (env) q.set("env", env);
        const data = await api(`/api/orders/balance?${q}`);
        if (cancelled) return;
        setBalance(data);
        setBalError("");
      } catch (err) {
        if (!cancelled) {
          setBalance(null);
          setBalError(err.message || "Không đọc được số dư");
        }
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [account, env, form.sizeMode]);

  const estimate = useMemo(() => estimateSize({
    mode: form.sizeMode || "qty",
    quantity: form.quantity,
    percent: form.percent,
    usdt: form.usdt,
    riskBudget: form.riskBudget,
    stop: stop || form.stop,
    available: balance?.available,
    leverage,
    price,
  }), [form.sizeMode, form.quantity, form.percent, form.usdt, form.riskBudget, form.stop, balance, leverage, price, stop]);

  function patch(partial) {
    const next = { ...form, ...partial };
    const nextEstimate = estimateSize({
      mode: next.sizeMode || "qty",
      quantity: next.quantity,
      percent: next.percent,
      usdt: next.usdt,
      riskBudget: next.riskBudget,
      stop: stop || next.stop,
      available: balance?.available,
      leverage,
      price,
    });
    onChange?.({ ...next, estimate: nextEstimate, balance });
  }

  // Khi balance về sau, đẩy lại estimate (không đụng field đang gõ).
  useEffect(() => {
    if (!balance) return;
    onChange?.({ ...form, estimate, balance });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balance?.available, balance?.at]);

  const percentList = presets === "close" ? CLOSE_PERCENTS : OPEN_PERCENTS;

  return (
    <div className="term-size stack">
      <div className="term-size-modes" role="tablist" aria-label="Cách nhập size">
        {SIZE_MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            role="tab"
            className={form.sizeMode === mode.id ? "active" : ""}
            disabled={disabled}
            onClick={() => patch({ sizeMode: mode.id })}
          >
            {mode.label}
          </button>
        ))}
      </div>

      {form.sizeMode === "qty" ? (
        <label>Số lượng (qty)
          <input
            inputMode="decimal"
            disabled={disabled}
            value={form.quantity || ""}
            onChange={(e) => patch({ quantity: e.target.value.replace(/,/g, ""), sizeMode: "qty" })}
          />
        </label>
      ) : null}

      {form.sizeMode === "percent" ? (
        <>
          <label>% ví (margin)
            <input
              inputMode="decimal"
              disabled={disabled}
              value={form.percent || ""}
              onChange={(e) => patch({ percent: e.target.value.replace(/,/g, ""), sizeMode: "percent" })}
              placeholder="vd 5"
            />
          </label>
          <div className="term-percents">
            {percentList.map((p) => (
              <button
                key={p}
                type="button"
                className={Number(form.percent) === p ? "active" : ""}
                disabled={disabled || balance?.available == null}
                onClick={() => patch({ percent: String(p), sizeMode: "percent" })}
              >
                {p}%
              </button>
            ))}
          </div>
        </>
      ) : null}

      {form.sizeMode === "usdt" ? (
        <label>Giá trị USDT (notional)
          <input
            inputMode="decimal"
            disabled={disabled}
            value={form.usdt || ""}
            onChange={(e) => patch({ usdt: e.target.value.replace(/,/g, ""), sizeMode: "usdt" })}
            placeholder="vd 200"
          />
        </label>
      ) : null}

      {form.sizeMode === "risk" ? (
        <>
          <label>Rủi ro USDT tới SL
            <input
              inputMode="decimal"
              disabled={disabled}
              value={form.riskBudget || ""}
              onChange={(e) => patch({ riskBudget: e.target.value.replace(/,/g, ""), sizeMode: "risk" })}
              placeholder="vd 10"
            />
          </label>
          <label>Giá SL (để tính size)
            <input
              inputMode="decimal"
              disabled={disabled}
              value={form.stop || stop || ""}
              onChange={(e) => patch({ stop: e.target.value.replace(/,/g, ""), sizeMode: "risk" })}
            />
          </label>
        </>
      ) : null}

      <p className="muted term-size-hint">
        {sizeHint(estimate, form)}
        {balance?.available != null ? ` · available ${balance.available}` : ""}
        {balance?.stale ? " · số dư có thể cũ" : ""}
      </p>
      {balError ? <p className="form-error">{balError}</p> : null}
      {form.sizeMode === "percent" && balance?.available == null && !balError ? (
        <p className="muted">Cần Redis wb:bal từ bot để tính % ví.</p>
      ) : null}
    </div>
  );
}
