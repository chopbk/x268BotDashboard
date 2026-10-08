import { useEffect, useState } from "react";
import { api } from "../api";

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const text = n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n > 0 ? "+" : ""}${text}$`.replace("+-", "-");
}

function plain(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}$`;
}

function tone(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return "";
  return n > 0 ? "positive" : "negative";
}

function filterUsers(users, showOthers, showInactive) {
  return (users || []).filter((item) => {
    if (!showInactive && item.active === false) return false;
    if (!showOthers && !item.mine) return false;
    return true;
  });
}

function points(series, key, width, height, minValue, maxValue) {
  const values = series.map((row) => Number(row[key]) || 0);
  const min = minValue == null ? Math.min(...values) : minValue;
  const max = maxValue == null ? Math.max(...values) : maxValue;
  const span = max - min || 1;
  return values.map((value, index) => {
    const x = 12 + (index * (width - 24)) / Math.max(series.length - 1, 1);
    const y = height - 12 - ((value - min) * (height - 24)) / span;
    return `${x},${y}`;
  }).join(" ");
}

export default function AccountLedgerPage() {
  const [days, setDays] = useState("14");
  const [username, setUsername] = useState("");
  const [showOthers, setShowOthers] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const params = new URLSearchParams({ days });
    if (username) params.set("username", username);
    setLoading(true);
    api(`/api/account-ledger?${params}`, { signal: controller.signal })
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError("");
        if (!username) {
          const choices = filterUsers(result.users, showOthers, showInactive);
          const preferred = choices.find((item) => item.username === result.username) || choices[0];
          if (preferred) setUsername(preferred.username);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Không tải được lãi lỗ");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [days, username]);

  const choices = filterUsers(data?.users, showOthers, showInactive);

  useEffect(() => {
    if (!data) return;
    const next = filterUsers(data.users, showOthers, showInactive);
    if (next.some((item) => item.username === username)) return;
    setUsername(next[0]?.username || "");
  }, [data, showInactive, showOthers, username]);

  async function refresh() {
    if (!data?.username) return;
    setBusy(true);
    setError("");
    try {
      const result = await api(`/api/account-ledger/${encodeURIComponent(data.username)}/refresh`, {
        method: "POST",
        body: { days: Number(days) },
      });
      setData(result);
    } catch (err) {
      setError(err.message || "Không cập nhật được số liệu sàn");
    } finally {
      setBusy(false);
    }
  }

  const series = data?.series || [];
  const totals = data?.totals || {};
  const live = data?.live || {};
  const compare = data?.compare || {};
  const cashSeries = series.map((row, index) => ({
    ymd: row.ymd,
    cash: series.slice(0, index + 1).reduce((sum, item) => sum + (Number(item.cashIn) || 0) + (Number(item.cashOut) || 0), 0),
    trading: series.slice(0, index + 1).reduce((sum, item) => sum + (Number(item.trading) || 0), 0),
  }));
  const flowValues = cashSeries.flatMap((row) => [row.cash, row.trading]);
  const flowMin = flowValues.length ? Math.min(...flowValues) : 0;
  const flowMax = flowValues.length ? Math.max(...flowValues) : 0;

  return (
    <section>
      <header className="page-head summary-head">
        <div>
          <h1>Lãi lỗ tài khoản</h1>
          <p className="muted">Số dư, income và hiệu suất lấy từ database. Cập nhật chỉ gọi API sàn cho ngày UTC hôm nay, với user bạn được xem.</p>
        </div>
        <div className="ledger-tools">
          <label>
            User
            <select value={choices.some((item) => item.username === username) ? username : ""} onChange={(event) => setUsername(event.target.value)}>
              {choices.map((item) => (
                <option key={item.username} value={item.username}>{item.username}{item.active ? "" : " (tắt)"}</option>
              ))}
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={showOthers} onChange={(event) => setShowOthers(event.target.checked)} />
            Xem của người khác
          </label>
          <label className="check">
            <input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} />
            Xem account non-active
          </label>
          <label>
            Số ngày
            <select value={days} onChange={(event) => setDays(event.target.value)}>
              <option value="7">7 ngày</option>
              <option value="14">14 ngày</option>
              <option value="30">30 ngày</option>
              <option value="90">90 ngày</option>
            </select>
          </label>
          <button type="button" disabled={busy || !data?.username} onClick={refresh}>{busy ? "Đang cập nhật…" : "Cập nhật hôm nay"}</button>
        </div>
      </header>
      {error ? <p className="form-error">{error}</p> : null}
      {loading ? <p className="muted">Đang tải…</p> : null}
      {!loading && data && !choices.length ? <p className="muted">{showOthers ? "Không có user khác trong quyền xem." : "Bạn chưa có user bot đang active. Tick để xem người khác hoặc account đang tắt."}</p> : null}
      {data?.username && choices.some((item) => item.username === data.username) ? (
        <>
          <p className="muted">User {data.username} · ví ghi ở env {data.env} · {data.from} → {data.to} UTC{live.asOf ? ` · mốc ${new Date(live.asOf).toLocaleString("vi-VN")}` : ""}</p>
          <div className="stats-grid summary-grid">
            <article className="card summary-stat"><small>Ví futures</small><strong>{plain(live.wallet)}</strong></article>
            <article className="card summary-stat"><small>Khả dụng</small><strong>{plain(live.available)}</strong></article>
            <article className={`card summary-stat ${tone(live.unrealized)}`}><small>Lãi lỗ chưa chốt</small><strong>{money(live.unrealized)}</strong></article>
            <article className="card summary-stat"><small>Margin đang dùng</small><strong>{plain(live.margin)}</strong></article>
            <article className="card summary-stat"><small>Số dư DB</small><strong>{plain(compare.dbBalance)}</strong></article>
            <article className="card summary-stat"><small>Số dư sàn</small><strong>{plain(compare.exchangeBalance)}</strong></article>
            <article className={`card summary-stat ${tone(compare.diff)}`}><small>Lệch sàn so với DB trước cập nhật</small><strong>{money(compare.diff)}</strong></article>
            <article className={`card summary-stat ${tone(totals.staticDiff)}`}><small>Income sàn − profit lệnh DB</small><strong>{money(totals.staticDiff)}</strong></article>
          </div>

          <h2 className="summary-section-title">Đường số dư</h2>
          {series.length < 2 ? <p className="muted">Chưa đủ ngày trong database để vẽ.</p> : (
            <svg className="ledger-chart" viewBox="0 0 640 180" role="img" aria-label="Đường số dư">
              <polyline fill="none" stroke="var(--accent)" strokeWidth="2" points={points(series, "balance", 640, 180)} />
            </svg>
          )}

          <h2 className="summary-section-title">Trading PnL và dòng tiền</h2>
          <p className="ledger-legend"><span className="ledger-trade">Trading PnL cộng dồn</span><span className="ledger-cash">Nạp, rút và chuyển cộng dồn</span></p>
          {series.length < 2 ? null : (
            <svg className="ledger-chart" viewBox="0 0 640 180" role="img" aria-label="Trading và dòng tiền">
              <polyline fill="none" className="ledger-trade-line" strokeWidth="2" points={points(cashSeries, "trading", 640, 180, flowMin, flowMax)} />
              <polyline fill="none" className="ledger-cash-line" strokeWidth="2" points={points(cashSeries, "cash", 640, 180, flowMin, flowMax)} />
            </svg>
          )}
          <div className="stats-grid">
            <article className={`card summary-stat ${tone(totals.trading)}`}><small>Trading PnL, gồm phí funding rebate</small><strong>{money(totals.trading)}</strong></article>
            <article className="card summary-stat"><small>Phí</small><strong>{money(totals.fee)}</strong></article>
            <article className="card summary-stat"><small>Funding</small><strong>{money(totals.funding)}</strong></article>
            <article className="card summary-stat"><small>Rebate</small><strong>{money(totals.rebate)}</strong></article>
            <article className={`card summary-stat ${tone(totals.cashIn)}`}><small>Nạp / chuyển vào</small><strong>{money(totals.cashIn)}</strong></article>
            <article className={`card summary-stat ${tone(totals.cashOut)}`}><small>Rút / chuyển ra</small><strong>{money(totals.cashOut)}</strong></article>
            <article className="card summary-stat"><small>Quy đổi</small><strong>{money(totals.conversion)}</strong></article>
            <article className={`card summary-stat ${tone(totals.staticProfit)}`}><small>Profit lệnh trong DB</small><strong>{money(totals.staticProfit)}</strong></article>
          </div>

          <h2 className="summary-section-title">Income theo ngày</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Ngày</th><th>Số dư</th><th>Trading</th><th>Phí</th><th>Funding</th><th>Nạp/vào</th><th>Rút/ra</th></tr>
              </thead>
              <tbody>
                {series.map((row) => (
                  <tr key={row.ymd}>
                    <td>{row.ymd}</td>
                    <td>{plain(row.balance)}</td>
                    <td className={tone(row.trading)}>{money(row.trading)}</td>
                    <td>{money(row.fee)}</td>
                    <td>{money(row.funding)}</td>
                    <td>{money(row.cashIn)}</td>
                    <td>{money(row.cashOut)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="summary-section-title">Nạp, rút và chuyển</h2>
          {(data.flows || []).length ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Ngày</th><th>Vào</th><th>Ra</th><th>Chuyển vào</th><th>Chuyển ra</th><th>Quy đổi</th></tr></thead>
                <tbody>
                  {data.flows.map((row) => (
                    <tr key={row.ymd}>
                      <td>{row.ymd}</td>
                      <td>{money(row.cashIn)}</td>
                      <td>{money(row.cashOut)}</td>
                      <td>{money(row.transferIn)}</td>
                      <td>{money(row.transferOut)}</td>
                      <td>{money(row.conversion)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="muted">Không có nạp, rút hoặc chuyển trong khoảng này.</p>}
          {series.some((row) => row.cashEntries?.length) ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Thời điểm</th><th>Loại</th><th>Asset</th><th>Số tiền</th></tr></thead>
                <tbody>
                  {series.flatMap((row) => (row.cashEntries || []).map((entry, index) => (
                    <tr key={`${row.ymd}-${index}`}>
                      <td>{entry.time ? new Date(entry.time).toLocaleString("vi-VN") : row.ymd}</td>
                      <td>{entry.type}</td>
                      <td>{entry.asset}</td>
                      <td>{money(entry.income)}</td>
                    </tr>
                  )))}
                </tbody>
              </table>
            </div>
          ) : <p className="muted">Chi tiết từng lệnh nạp, rút, chuyển của hôm nay hiện sau khi bấm Cập nhật.</p>}
        </>
      ) : null}
    </section>
  );
}
