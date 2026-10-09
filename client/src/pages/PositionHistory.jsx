import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useEscape } from "../navigation";

function num(value, digits = 2) {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function signed(value) {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const text = n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return n > 0 ? `+${text}` : text;
}

function when(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("vi-VN");
}

function holdText(ms) {
  if (ms == null) return "—";
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} phút`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} giờ ${minutes % 60} phút`;
  return `${Math.floor(hours / 24)} ngày ${hours % 24} giờ`;
}

function tone(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return "";
  return n > 0 ? "pos-up" : "pos-down";
}

function SummaryCard({ title, summary }) {
  if (!summary) return null;
  return (
    <article className="card summary-stat">
      <small>{title}</small>
      <strong className={tone(summary.profit)}>{signed(summary.profit)}</strong>
      <span className="muted">{summary.count} lệnh · thắng {summary.wins} / thua {summary.losses} / hòa {summary.flats}{summary.missingProfit ? ` · thiếu PnL ${summary.missingProfit}` : ""}</span>
      <span className="muted">Win rate {summary.winRate == null ? "—" : `${num(summary.winRate, 1)}%`} · PF {summary.profitFactor == null ? "—" : num(summary.profitFactor, 2)}</span>
      <span className="muted">Lãi TB {signed(summary.avgWin)} · lỗ TB {signed(summary.avgLoss)} · giữ TB {holdText(summary.avgHoldMs)}</span>
    </article>
  );
}

export default function PositionHistory({ params, go, canStats, onAccounts }) {
  const trade = params.get("trade") || "";
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [fresh, setFresh] = useState(false);
  const [reload, setReload] = useState(0);
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState("");

  function queryString() {
    const query = new URLSearchParams();
    query.set("audience", params.get("audience") === "all" ? "all" : "mine");
    for (const key of ["account", "env", "symbol", "side", "signal", "profit", "reason", "copy", "from", "to"]) {
      const value = params.get(key);
      if (value) query.set(key, value);
    }
    const book = params.get("book") || "";
    if (book === "paper" || book === "all") query.set("book", book);
    query.set("range", params.get("range") || "30");
    query.set("page", params.get("page") || "1");
    query.set("sort", params.get("hsort") || "time");
    query.set("dir", params.get("hdir") || "desc");
    return query;
  }

  useEffect(() => {
    if (!canStats) return undefined;
    let gone = false;
    const controller = new AbortController();
    setLoading(true);
    api(`/api/positions/history?${queryString()}`, { signal: controller.signal })
      .then((body) => {
        if (gone) return;
        setData(body);
        setError("");
        setFresh(false);
        onAccounts?.(body.accounts || []);
      })
      .catch((err) => {
        if (!gone) setError(err.message || "Không tải được lịch sử");
      })
      .finally(() => {
        if (!gone) setLoading(false);
      });
    return () => {
      gone = true;
      controller.abort();
    };
  }, [canStats, params, reload]);

  useEffect(() => {
    if (!canStats || !data) return undefined;
    const timer = window.setInterval(() => {
      api(`/api/positions/history?${queryString()}`)
        .then((body) => {
          const next = body.rows?.[0]?.id || "";
          const current = data.rows?.[0]?.id || "";
          if (next && next !== current) setFresh(true);
        })
        .catch(() => {});
    }, 30000);
    return () => window.clearInterval(timer);
  }, [canStats, data, params]);

  useEffect(() => {
    if (!trade) {
      setDetail(null);
      return undefined;
    }
    let gone = false;
    const query = new URLSearchParams();
    query.set("audience", params.get("audience") === "all" ? "all" : "mine");
    api(`/api/positions/history/${encodeURIComponent(trade)}?${query}`)
      .then((body) => { if (!gone) { setDetail(body); setDetailError(""); } })
      .catch((err) => { if (!gone) setDetailError(err.message || "Không tải được lệnh"); });
    return () => { gone = true; };
  }, [trade, params]);

  function closeTrade() {
    go((query) => query.delete("trade"));
    window.setTimeout(() => document.querySelector(`[data-row="${CSS.escape(trade)}"]`)?.focus(), 0);
  }

  useEscape(Boolean(trade), closeTrade);

  function sortBy(key) {
    go((query) => {
      const current = query.get("hsort") || "time";
      const dir = query.get("hdir") || "desc";
      query.set("hsort", key);
      query.set("hdir", current === key && dir === "desc" ? "asc" : "desc");
      query.delete("page");
    });
  }

  if (!canStats) return <p className="muted">Cần quyền statistics.view để xem lịch sử lệnh. Quyền xem vị thế đang mở không mở sổ này.</p>;

  const range = params.get("range") || "30";
  const page = Number(data?.page || 1);
  const pages = Math.max(1, Math.ceil((data?.total || 0) / (data?.limit || 30)));

  return (
    <div className="stack">
      <div className="signal-filters">
        <label>Đóng
          <select value={range} onChange={(event) => go((query) => { query.set("range", event.target.value); query.delete("page"); })}>
            <option value="today">Hôm nay UTC</option>
            <option value="7">7 ngày</option>
            <option value="30">30 ngày</option>
            <option value="90">90 ngày</option>
            <option value="custom">Tùy chọn</option>
          </select>
        </label>
        {range === "custom" ? (
          <>
            <label>Từ UTC
              <input type="date" value={params.get("from") || ""} onChange={(event) => go((query) => { if (event.target.value) query.set("from", event.target.value); else query.delete("from"); query.set("range", "custom"); query.delete("page"); })} />
            </label>
            <label>Đến UTC
              <input type="date" value={params.get("to") || ""} onChange={(event) => go((query) => { if (event.target.value) query.set("to", event.target.value); else query.delete("to"); query.set("range", "custom"); query.delete("page"); })} />
            </label>
          </>
        ) : null}
        <label>Kết quả
          <select value={params.get("profit") || ""} onChange={(event) => go((query) => { if (event.target.value) query.set("profit", event.target.value); else query.delete("profit"); query.delete("page"); })}>
            <option value="">Tất cả</option>
            <option value="win">Lãi</option>
            <option value="loss">Lỗ</option>
            <option value="flat">Hòa</option>
          </select>
        </label>
        <label>Lý do đóng
          <select value={params.get("reason") || ""} onChange={(event) => go((query) => { if (event.target.value) query.set("reason", event.target.value); else query.delete("reason"); query.delete("page"); })}>
            <option value="">Tất cả</option>
            <option value="tp">TP</option>
            <option value="sl">SL</option>
            <option value="trailing">Trailing</option>
            <option value="signal">Signal</option>
            <option value="manual">Thủ công</option>
            <option value="max_loss">Max loss</option>
            <option value="gone">Hết vị thế</option>
            <option value="unknown">Không xác định</option>
          </select>
        </label>
        <label>Copy
          <select value={params.get("copy") || ""} onChange={(event) => go((query) => { if (event.target.value) query.set("copy", event.target.value); else query.delete("copy"); query.delete("page"); })}>
            <option value="">Tất cả</option>
            <option value="copy">Copy</option>
            <option value="manual">Không copy</option>
          </select>
        </label>
      </div>
      <p className="muted">Mỗi dòng là một account_statics lúc monitor của config đóng, không tách từng lần TP. Live và paper không cộng chung. {data?.formula?.pnl}</p>
      <p className="muted">{data?.formula?.winRate} {data?.formula?.profitFactor}</p>
      {fresh ? <p className="pos-stale">Có lệnh đóng mới. Bộ lọc vẫn giữ. <button type="button" onClick={() => setReload((value) => value + 1)}>Tải lại</button></p> : null}
      {error ? <p className="form-error">{error}</p> : null}
      {loading ? <p className="muted">Đang tải lịch sử…</p> : null}
      {data ? (
        <div className="stats-grid">
          <SummaryCard title="Live · profit đã lưu" summary={data.summaries?.live} />
          <SummaryCard title="Paper · profit đã lưu" summary={data.summaries?.paper} />
        </div>
      ) : null}
      {!loading && data && !data.rows?.length ? <p className="muted">Không có lệnh đóng trong bộ lọc này.</p> : null}
      {data?.rows?.length ? (
        <div className="table-wrap">
          <table className="pos-table">
            <thead>
              <tr>
                <th><button type="button" className="sort-col" onClick={() => sortBy("time")}>Đóng</button></th>
                <th>Tài khoản</th>
                <th>Signal</th>
                <th>Symbol</th>
                <th>Vào / ra</th>
                <th>Qty</th>
                <th><button type="button" className="sort-col" onClick={() => sortBy("pnl")}>PnL</button></th>
                <th>ROE</th>
                <th><button type="button" className="sort-col" onClick={() => sortBy("hold")}>Giữ</button></th>
                <th>Lý do</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.id}>
                  <td>{when(row.closeTime)}</td>
                  <td>{row.account} · {row.env}</td>
                  <td>{row.signal || "—"}</td>
                  <td>
                    <button type="button" className="linkish" data-row={row.id} onClick={() => go((query) => query.set("trade", row.id), { layer: true })}>{row.symbol}</button>
                    <span className="muted"> {row.side}{row.paper ? " · Paper" : " · Live"}{row.copy ? " · Copy" : ""}</span>
                  </td>
                  <td>{num(row.entry, 4)} / {num(row.exit, 4)}</td>
                  <td>{num(row.qty, 4)}</td>
                  <td className={tone(row.profit)}>{signed(row.profit)}</td>
                  <td title={row.roeBasis}>{num(row.roe, 2)}</td>
                  <td>{holdText(row.holdMs)}</td>
                  <td>{row.reasonLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {data && pages > 1 ? (
        <p className="muted">
          Trang {page}/{pages}
          <button type="button" className="ghost" disabled={page <= 1} onClick={() => go((query) => query.set("page", String(page - 1)))}>Trước</button>
          <button type="button" className="ghost" disabled={page >= pages} onClick={() => go((query) => query.set("page", String(page + 1)))}>Sau</button>
        </p>
      ) : null}
      {trade ? (
        <div className="modal-backdrop" onClick={closeTrade}>
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="hist-title" onClick={(event) => event.stopPropagation()}>
            <header>
              <h2 id="hist-title">{detail ? `${detail.symbol} · ${detail.side}` : "Lệnh"}</h2>
              <button type="button" onClick={closeTrade}>Đóng</button>
            </header>
            {detailError ? <p className="form-error">{detailError}</p> : null}
            {!detail && !detailError ? <p className="muted">Đang tải…</p> : null}
            {detail ? <TradeDetail detail={detail} /> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TradeDetail({ detail }) {
  return (
    <div className="pos-detail">
      <p>{detail.narrative}</p>
      <p className="muted">Nguồn {detail.source}. Thiếu: {detail.missing?.length ? detail.missing.join(", ") : "không"}.</p>
      <p>Mở {when(detail.openTime)} · đóng {when(detail.closeTime)} · {detail.account} / {detail.env} · {detail.signal || "không signal"} · {detail.reasonLabel}</p>
      <p>Entry {num(detail.entry, 4)} · exit {num(detail.exit, 4)} · qty {num(detail.qty, 4)} · đòn bẩy {num(detail.leverage, 0)} · vốn {num(detail.cost, 2)}</p>
      <p className={tone(detail.profit)}>PnL đã lưu {signed(detail.profit)}. ROE {num(detail.roe, 2)} ({detail.roeBasis}).</p>
      <p className="muted">{detail.costs?.note} Realized {signed(detail.costs?.realized)} · phí {signed(detail.costs?.commission)} · funding {signed(detail.costs?.funding)}.</p>
      <p className="muted">{detail.observed?.note} ROE cao {num(detail.observed?.maxRoe, 1)} · ROE thấp {num(detail.observed?.minRoe, 1)} · lãi mở cao {signed(detail.observed?.maxUnrealized)} · thấp {signed(detail.observed?.minUnrealized)}.</p>
      <p className="muted">{detail.rNote} R {detail.rMultiple == null ? "—" : num(detail.rMultiple, 2)}.</p>
      <p>
        {detail.links?.config ? <Link to={detail.links.config}>Mở config hiện tại của env này</Link> : <span className="muted">Không có quyền mở config</span>}
        <span className="muted">{detail.links?.monitorId ? " · Còn monitor khớp env, symbol, side và giờ mở" : " · Không thấy monitor khớp env, symbol, side và giờ mở"}</span>
      </p>
      <h3>Snapshot lúc mở</h3>
      <pre>{JSON.stringify(detail.stats || {}, null, 2)}</pre>
      <h3>Logs</h3>
      {(detail.logs || []).length ? (
        <ul className="pos-list">
          {detail.logs.map((row, index) => <li key={`${row.at || ""}-${index}`}>{when(row.at)} · {row.phase} · {row.event} · {row.message}</li>)}
        </ul>
      ) : <p className="muted">Không có log.</p>}
    </div>
  );
}
