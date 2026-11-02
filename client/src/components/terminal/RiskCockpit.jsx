import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { money, moneyShort, pct } from "../charts/format.js";
import { topNotionalGroups } from "../charts/rankNotional.js";
import "../charts/charts.css";

/**
 * P1 Risk cockpit — Long/Short + top symbol notional.
 * Observe mặc định; không tự enforce. Bấm symbol chỉ lọc bảng.
 */
export default function RiskCockpit({
  account = "",
  canManage = false,
  selectedSymbol = "",
  onSelectSymbol,
}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const prevAccount = useRef(account);

  async function load() {
    if (!account) return;
    setBusy(true);
    setError("");
    try {
      const res = await api(`/api/risk/portfolio?username=${encodeURIComponent(account)}`);
      setData(res);
    } catch (err) {
      setError(err.message || "Không tải risk");
      setData(null);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load();
  }, [account]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (prevAccount.current !== account) {
      prevAccount.current = account;
      if (selectedSymbol && onSelectSymbol) onSelectSymbol("");
    }
  }, [account, selectedSymbol, onSelectSymbol]);

  async function pauseEntries(pause) {
    if (!canManage || !account) return;
    setBusy(true);
    try {
      await api("/api/risk/controls", {
        method: "POST",
        body: { type: pause ? "pause_new_entries" : "resume_new_entries", username: account },
      });
      await load();
    } catch (err) {
      setError(err.message || "Control thất bại");
    } finally {
      setBusy(false);
    }
  }

  if (!account) return <p className="muted">Chọn tài khoản để xem risk.</p>;

  const snap = data?.snapshot;
  const policy = data?.policy;
  const longN = Number(snap?.longNotional) || 0;
  const shortN = Number(snap?.shortNotional) || 0;
  const grossSide = longN + shortN;
  const longPct = grossSide > 0 ? (longN / grossSide) * 100 : 0;
  const shortPct = grossSide > 0 ? (shortN / grossSide) * 100 : 0;
  const netSide = longN - shortN;
  const ranked = topNotionalGroups(Array.isArray(snap?.bySymbol) ? snap.bySymbol : [], { limit: 5 });
  const stale = snap?.walletStale === true;
  const quality = snap?.provenance?.quality || "?";

  function pickSymbol(name) {
    if (!onSelectSymbol || name === "Khác" || name === "__other__") return;
    onSelectSymbol(selectedSymbol === name ? "" : name);
  }

  return (
    <div className="term-risk-cockpit">
      <header className="term-plan-head">
        <strong>Risk · {account}</strong>
        <div className="term-risk-head-actions">
          <button type="button" className="ghost" disabled={busy} onClick={load}>Làm mới</button>
          <button type="button" className="ghost" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? "Thu gọn" : "Chi tiết"}
          </button>
        </div>
      </header>
      {error ? <p className="form-error">{error}</p> : null}
      {stale ? (
        <p className="term-risk-stale" role="status">
          Snapshot ví stale / thiếu — không diễn giải “an toàn”. quality={quality}
        </p>
      ) : null}

      {snap ? (
        <>
          <section className="term-risk-share" aria-label="Tỷ trọng Long Short">
            <p className="term-risk-share-title">Long / Short notional</p>
            {grossSide <= 0 ? (
              <p className="muted">Không có vị thế</p>
            ) : (
              <>
                <div className="dv-share-bar" role="img" aria-label={`Long ${pct(longPct)} ${money(longN)}, Short ${pct(shortPct)} ${money(shortN)}`}>
                  <span className="dv-share-seg long" style={{ width: `${longPct}%` }} title={`Long ${money(longN)}`} />
                  <span className="dv-share-seg short" style={{ width: `${shortPct}%` }} title={`Short ${money(shortN)}`} />
                </div>
                <ul className="dv-share-legend">
                  <li><span className="dv-share-swatch long" /> Long {pct(longPct)} · {moneyShort(longN)}</li>
                  <li><span className="dv-share-swatch short" /> Short {pct(shortPct)} · {moneyShort(shortN)}</li>
                </ul>
                <p className="muted term-risk-net">
                  Net Long−Short {moneyShort(netSide)} · Gross {moneyShort(snap.gross)} (hedge cân bằng vẫn có gross lớn)
                </p>
              </>
            )}
          </section>

          <section className="term-risk-symbols" aria-label="Phân bổ symbol">
            <p className="term-risk-share-title">Top symbol theo gross notional</p>
            {!ranked.shown.length ? (
              <p className="muted">Không có symbol</p>
            ) : (
              <ul className="dv-exposure-list" role="list">
                {ranked.shown.map((row) => {
                  const width = `${Math.max(4, (row.value / ranked.max) * 100)}%`;
                  const active = selectedSymbol === row.name;
                  return (
                    <li key={row.id}>
                      <button
                        type="button"
                        className={`dv-exposure-hit${active ? " active" : ""}`}
                        aria-pressed={active}
                        aria-label={`${row.name}: notional ${money(row.value)}. Lọc bảng, không đổi ticket.`}
                        onClick={() => pickSymbol(row.name)}
                      >
                        <span className="dv-exposure-label">{row.name}</span>
                        <span className="dv-exposure-track" aria-hidden="true">
                          <span className="dv-exposure-bar" style={{ width }} />
                        </span>
                        <span className="dv-exposure-value">{moneyShort(row.value)}</span>
                      </button>
                    </li>
                  );
                })}
                {ranked.other ? (
                  <li>
                    <div className="dv-exposure-hit muted" style={{ cursor: "default" }}>
                      <span className="dv-exposure-label">Khác ({ranked.other.count})</span>
                      <span className="dv-exposure-track" aria-hidden="true">
                        <span className="dv-exposure-bar other" style={{ width: `${Math.max(4, (ranked.other.value / ranked.max) * 100)}%` }} />
                      </span>
                      <span className="dv-exposure-value">{moneyShort(ranked.other.value)}</span>
                    </div>
                  </li>
                ) : null}
              </ul>
            )}
            <p className="muted">Bấm symbol lọc bảng · không đổi ticket / side / gửi lệnh. Reserved {moneyShort(snap.reservedNotional)} · Pending {moneyShort(snap.pendingEntryNotional)} (riêng vị thế đã khớp).</p>
          </section>

          {open ? (
            <ul className="term-risk-metrics">
              <li>quality={quality} · mode={policy?.mode || "unset"} · rev={policy?.revision ?? "—"}</li>
              <li>Equity: {snap.equity ?? "unknown"}</li>
              <li>Gross: {snap.gross ?? "—"} · Net: {snap.net ?? "—"}</li>
              <li>Lev hiệu dụng: {snap.leverageEff ?? "—"}</li>
              <li>Risk@SL covered: {snap.coveredRiskAtStop ?? "—"} · unprotected qty: {snap.unprotectedQty ?? "—"}</li>
              <li>Daily loss: {snap.dailyLoss ?? "unknown"} ({snap.dailyLossQuality})</li>
              {snap.attribution?.length ? (
                <li>Attribution own-qty: {snap.attribution.length} monitor dòng (không cộng trùng sàn).</li>
              ) : null}
            </ul>
          ) : null}
        </>
      ) : (
        <p className="muted">{busy ? "Đang tải…" : "Chưa có snapshot"}</p>
      )}

      {canManage ? (
        <div className="term-plan-actions">
          <button type="button" disabled={busy} onClick={() => pauseEntries(true)}>Pause entries</button>
          <button type="button" className="ghost" disabled={busy} onClick={() => pauseEntries(false)}>Resume</button>
        </div>
      ) : (
        <p className="muted">Cần risk.manage để pause/resume (mặc định observe).</p>
      )}
    </div>
  );
}
