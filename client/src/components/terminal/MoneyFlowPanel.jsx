import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";

function fmtNum(value, digits = 2) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const n = Number(value);
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toLocaleString("en-US", { maximumFractionDigits: digits })}`;
}

function toneClass(value) {
  if (value == null || !Number.isFinite(Number(value))) return "";
  const n = Number(value);
  if (n > 0) return "positive";
  if (n < 0) return "negative";
  return "";
}

/**
 * Dòng tiền từ snapshot Smart Money chung — không gọi collector riêng.
 */
export default function MoneyFlowPanel({ row }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const symbol = String(row?.symbol || "").toUpperCase();
    if (!symbol) {
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    setError("");
    const qty = Math.abs(Number(row?.positionAmt ?? row?.size ?? 0));
    const mark = Number(row?.mark);
    const notional = Number.isFinite(qty) && Number.isFinite(mark) ? qty * mark : null;
    const qs = new URLSearchParams();
    if (row?.side) qs.set("side", String(row.side).toUpperCase());
    if (notional != null) qs.set("notional", String(notional));
    api(`/api/smart-money/money-flow/${encodeURIComponent(symbol)}?${qs}`)
      .then((body) => {
        if (!cancelled) setData(body);
      })
      .catch((err) => {
        if (!cancelled) {
          // Thiếu permission smart_money.view → ẩn khối, không phá Terminal.
          if (err?.status === 403) setData({ available: false, reason: "forbidden" });
          else setError(err.message || "Không tải dòng tiền");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [row?.symbol, row?.side, row?.mark, row?.positionAmt, row?.size]);

  if (data?.reason === "forbidden") return null;

  return (
    <div className="term-overview-money-flow stack">
      <h3 className="term-overview-subhead">Dòng tiền</h3>
      {loading ? <p className="muted">Đang tải snapshot thị trường…</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
      {!loading && data && !data.available ? (
        <p className="muted">{data.summary || "Chưa có dữ liệu Smart Money — đang warm-up."}</p>
      ) : null}
      {!loading && data?.available ? (
        <>
          <p>{data.summary}</p>
          <div className="term-kv">
            {(data.metrics || []).slice(0, 6).map((m) => (
              <div key={m.key}>
                <span title={m.detail || ""}>{m.label}</span>
                <strong className={`term-num ${toneClass(typeof m.value === "number" ? m.value : null)}`}>
                  {typeof m.value === "number" ? `${fmtNum(m.value)}${m.unit || ""}` : m.value ?? "—"}
                </strong>
              </div>
            ))}
          </div>
          {(data.alerts || []).length ? (
            <ul className="term-money-alerts">
              {data.alerts.map((a, i) => (
                <li key={`${a.level}-${i}`} className={a.level === "warn" ? "form-error" : "muted"}>
                  {a.text}
                </li>
              ))}
            </ul>
          ) : null}
          {data.smartMoneyPath ? (
            <Link className="trail-link" to={data.smartMoneyPath}>
              Mở Smart Money
            </Link>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
