import { useEffect, useState } from "react";
import { api } from "../api";

function number(value, digits = 0) {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: digits }).format(Number(value) || 0);
}

function money(value) {
  return `${number(value, 2)} $`;
}

function Stat({ label, value, note, tone = "", rank = false }) {
  return <article className={`card summary-stat ${tone} ${rank ? "summary-rank" : ""}`}><span className="muted">{label}</span><strong>{value}</strong>{note ? <small className="muted">{note}</small> : null}</article>;
}

function rankValue(item) {
  return item?.name || "—";
}

function rankNote(item) {
  if (!item) return "Chưa có lệnh trong kỳ";
  return `${money(item.profit)} · ${number(item.trades)} lệnh · WR ${number(item.winRate, 1)}%`;
}

function rankTone(item) {
  if (!item) return "";
  return item.profit < 0 ? "negative" : "positive";
}

const FACTORS = [
  { id: "profit", label: "Profit" },
  { id: "volume", label: "Volume" },
  { id: "winRate", label: "Win rate" },
  { id: "trades", label: "Số lệnh" },
];

function sortedUsers(rows, factor) {
  return [...(rows || [])].sort((a, b) => (b[factor] || 0) - (a[factor] || 0) || (b.profit || 0) - (a.profit || 0) || (b.volume || 0) - (a.volume || 0));
}

export default function SummaryPage() {
  const [range, setRange] = useState("3d");
  const [factor, setFactor] = useState("profit");
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setSummary(null);
    setError("");
    api(`/api/summary?range=${range}`, { signal: controller.signal }).then((data) => active && setSummary(data)).catch((err) => active && setError(err.message));
    return () => { active = false; controller.abort(); };
  }, [range]);

  return (
    <section>
      <header className="page-head summary-head"><div><h1>Tổng kết hệ thống</h1><p className="muted">Chỉ tính user bot đang active. Profit và volume lấy từ lệnh đóng trên Account Static của account. Thẻ xếp hạng chỉ hiện tín hiệu, user và symbol đứng đầu.</p></div><label>Khoảng thời gian<select value={range} onChange={(event) => setRange(event.target.value)}><option value="today">Hôm nay</option><option value="3d">3 ngày gần nhất</option><option value="7d">7 ngày gần nhất</option><option value="30d">30 ngày gần nhất</option><option value="90d">90 ngày gần nhất</option><option value="all">Toàn thời gian</option></select></label></header>
      {error ? <p className="form-error">{error}</p> : null}
      {!summary && !error ? <p className="muted">Đang tải số liệu…</p> : null}
      {summary ? <>
        <h2 className="summary-section-title">Hệ thống</h2>
        <div className="stats-grid summary-grid">
          <Stat label="User bot" value={number(summary.botCount)} note={`${number(summary.publicBotCount)} public · ${number(summary.privateBotCount)} private`} />
          <Stat label="Account config" value={number(summary.configCount)} note={`${number(summary.activeConfigCount)} đang bật · ${number(summary.inactiveConfigCount)} đang tắt`} />
          <Stat label="Signal trong kỳ" value={number(summary.signalCount)} note={`${number(summary.signalCount24h)} signal trong 24 giờ`} />
          <Stat label="Position đang mở" value={number(summary.openPositionCount)} note="Theo Monitor Position" />
        </div>
        <h2 className="summary-section-title">Hiệu suất giao dịch</h2>
        <div className="stats-grid summary-grid">
          <Stat label="Tổng giao dịch" value={number(summary.tradeCount)} note={`${number(summary.wins)} thắng · ${number(summary.losses)} thua`} />
          <Stat label="Win rate" value={`${number(summary.winRate, 1)}%`} note="Account Static, không gồm paper" />
          <Stat label="Profit hôm nay" value={money(summary.profitToday)} tone={summary.profitToday < 0 ? "negative" : "positive"} note="Lệnh đóng hôm nay theo UTC" />
          <Stat label="Profit trong kỳ" value={money(summary.profit)} tone={summary.profit < 0 ? "negative" : "positive"} note="Tổng profit lệnh Account Static đã đóng" />
          <Stat label="Volume trong kỳ" value={money(summary.volume)} note="Account Static của account, không lấy từ signal" />
          <Stat label="Profit Long" value={money(summary.longProfit)} tone={summary.longProfit < 0 ? "negative" : "positive"} />
          <Stat label="Profit Short" value={money(summary.shortProfit)} tone={summary.shortProfit < 0 ? "negative" : "positive"} />
        </div>
        <h2 className="summary-section-title">Xếp hạng trong kỳ</h2>
        <div className="stats-grid summary-grid">
          <Stat rank label="Tín hiệu tốt nhất" value={rankValue(summary.bestSignal)} note={rankNote(summary.bestSignal)} tone={rankTone(summary.bestSignal)} />
          <Stat rank label="Tín hiệu kém nhất" value={rankValue(summary.worstSignal)} note={rankNote(summary.worstSignal)} tone={rankTone(summary.worstSignal)} />
          <Stat rank label="User hiệu suất tốt nhất" value={rankValue(summary.bestUser)} note={rankNote(summary.bestUser)} tone={rankTone(summary.bestUser)} />
          <Stat rank label="Symbol lãi nhất" value={rankValue(summary.bestSymbol)} note={rankNote(summary.bestSymbol)} tone={rankTone(summary.bestSymbol)} />
        </div>
        <h2 className="summary-section-title">Bảng xếp hạng user</h2>
        <div className="history-tabs">
          {FACTORS.map((item) => (
            <button type="button" key={item.id} className={factor === item.id ? "active" : "ghost"} onClick={() => setFactor(item.id)}>
              Theo {item.label}
            </button>
          ))}
        </div>
        {sortedUsers(summary.userRanks, factor).length ? (
          <div className="table-wrap signal-table">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>User</th>
                  <th>Profit</th>
                  <th>Volume</th>
                  <th>Số lệnh</th>
                  <th>Win rate</th>
                  <th>Thắng</th>
                  <th>Thua</th>
                </tr>
              </thead>
              <tbody>
                {sortedUsers(summary.userRanks, factor).map((row, index) => (
                  <tr key={row.name}>
                    <td>{index + 1}</td>
                    <td>{row.name}</td>
                    <td>{money(row.profit)}</td>
                    <td>{money(row.volume)}</td>
                    <td>{number(row.trades)}</td>
                    <td>{number(row.winRate, 1)}%</td>
                    <td>{number(row.wins)}</td>
                    <td>{number(row.losses)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="card empty">Chưa có user active có lệnh trong kỳ.</div>}
        <p className="summary-updated muted">Dữ liệu được tính lúc: {new Date(summary.snapshot?.generatedAt || summary.generatedAt).toLocaleString("vi-VN")}{summary.snapshot?.status === "refreshing" ? " · đang làm mới nền" : summary.cached ? " · snapshot MongoDB" : ""}</p>
      </> : null}
    </section>
  );
}
