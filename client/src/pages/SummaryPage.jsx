import { useEffect, useState } from "react";
import { api } from "../api";

function number(value, digits = 0) {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: digits }).format(Number(value) || 0);
}

function money(value) {
  return `${number(value, 2)} $`;
}

function Stat({ label, value, note, tone = "" }) {
  return <article className={`card summary-stat ${tone}`}><span className="muted">{label}</span><strong>{value}</strong>{note ? <small className="muted">{note}</small> : null}</article>;
}

export default function SummaryPage() {
  const [range, setRange] = useState("3d");
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setSummary(null);
    setError("");
    api(`/api/summary?range=${range}`).then((data) => active && setSummary(data)).catch((err) => active && setError(err.message));
    return () => { active = false; };
  }, [range]);

  return (
    <section>
      <header className="page-head summary-head"><div><h1>Tổng kết hệ thống</h1><p className="muted">Chỉ hiển thị số liệu tổng hợp, không lộ user, bot hay config chi tiết.</p></div><label>Khoảng thời gian<select value={range} onChange={(event) => setRange(event.target.value)}><option value="3d">3 ngày gần nhất</option><option value="7d">7 ngày gần nhất</option><option value="30d">30 ngày gần nhất</option><option value="90d">90 ngày gần nhất</option><option value="all">Toàn thời gian</option></select></label></header>
      {error ? <p className="form-error">{error}</p> : null}
      {!summary && !error ? <p className="muted">Đang tải số liệu…</p> : null}
      {summary ? <>
        <h2 className="summary-section-title">Hệ thống</h2>
        <div className="stats-grid summary-grid">
          <Stat label="User bot" value={number(summary.botCount)} note={`${number(summary.publicBotCount)} public · ${number(summary.privateBotCount)} private`} />
          <Stat label="Account config" value={number(summary.configCount)} note={`${number(summary.activeConfigCount)} đang bật · ${number(summary.inactiveConfigCount)} đang tắt`} />
          <Stat label="Signal trong kỳ" value={number(summary.signalCount)} note={`${number(summary.signalCount24h)} signal trong 24 giờ`} />
          <Stat label="Position đang mở" value={number(summary.openPositionCount)} note="Theo Account Static" />
        </div>
        <h2 className="summary-section-title">Hiệu suất giao dịch</h2>
        <div className="stats-grid summary-grid">
          <Stat label="Tổng giao dịch" value={number(summary.tradeCount)} />
          <Stat label="Win rate" value={`${number(summary.winRate, 1)}%`} />
          <Stat label="Profit hôm nay" value={money(summary.profitToday)} tone={summary.profitToday < 0 ? "negative" : "positive"} note="Tính theo UTC" />
          <Stat label="Profit trong kỳ" value={money(summary.profit)} tone={summary.profit < 0 ? "negative" : "positive"} />
          <Stat label="Volume trong kỳ" value={money(summary.volume)} />
        </div>
        <p className="summary-updated muted">Cập nhật: {new Date(summary.generatedAt).toLocaleString("vi-VN")}{summary.cached ? " · dữ liệu cache" : ""}</p>
      </> : null}
    </section>
  );
}
