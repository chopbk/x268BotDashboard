import { useEffect, useState } from "react";
import { api } from "../../api";

/**
 * P2 Risk cockpit — observe mặc định; không tự enforce.
 */
export default function RiskCockpit({ account = "", canManage = false }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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

  return (
    <div className="term-risk-cockpit">
      <header className="term-plan-head">
        <strong>Risk · {account}</strong>
        <button type="button" className="ghost" disabled={busy} onClick={load}>Làm mới</button>
      </header>
      {error ? <p className="form-error">{error}</p> : null}
      {snap ? (
        <>
          <p className="muted">
            quality={snap.provenance?.quality || "?"} · mode={policy?.mode || "unset"} · rev={policy?.revision ?? "—"}
          </p>
          <ul className="term-risk-metrics">
            <li>Equity: {snap.equity ?? "unknown"}</li>
            <li>Gross: {snap.gross ?? "—"} · Net: {snap.net ?? "—"}</li>
            <li>Long: {snap.longNotional ?? "—"} · Short: {snap.shortNotional ?? "—"}</li>
            <li>Lev hiệu dụng: {snap.leverageEff ?? "—"}</li>
            <li>Risk@SL covered: {snap.coveredRiskAtStop ?? "—"} · unprotected qty: {snap.unprotectedQty ?? "—"}</li>
            <li>Daily loss: {snap.dailyLoss ?? "unknown"} ({snap.dailyLossQuality})</li>
            <li>Reserved: {snap.reservedNotional ?? 0} · Pending: {snap.pendingEntryNotional ?? 0}</li>
          </ul>
          {snap.attribution?.length ? (
            <p className="muted">Attribution own-qty: {snap.attribution.length} monitor dòng (không cộng trùng sàn).</p>
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
