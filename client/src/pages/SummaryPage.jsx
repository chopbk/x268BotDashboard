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
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api("/api/summary").then(setSummary).catch((err) => setError(err.message));
  }, []);

  return (
    <section>
      <header className="page-head"><div><h1>Tổng kết hệ thống</h1><p className="muted">Chỉ hiển thị số liệu tổng hợp, không lộ user, bot hay config chi tiết.</p></div></header>
      {error ? <p className="form-error">{error}</p> : null}
      {!summary && !error ? <p className="muted">Đang tải số liệu…</p> : null}
      {summary ? <>
        <h2 className="summary-section-title">Hệ thống</h2>
        <div className="stats-grid summary-grid">
          <Stat label="User bot" value={number(summary.botCount)} note={`${number(summary.publicBotCount)} public · ${number(summary.privateBotCount)} private`} />
          <Stat label="Account config" value={number(summary.configCount)} note={`${number(summary.activeConfigCount)} đang bật · ${number(summary.inactiveConfigCount)} đang tắt`} />
          <Stat label="Signal 24 giờ" value={number(summary.signalCount24h)} note={`${number(summary.signalCount)} signal toàn thời gian`} />
          <Stat label="Position đang mở" value={number(summary.openPositionCount)} note="Theo Account Static" />
        </div>
        <h2 className="summary-section-title">Hiệu suất giao dịch</h2>
        <div className="stats-grid summary-grid">
          <Stat label="Tổng giao dịch" value={number(summary.tradeCount)} />
          <Stat label="Win rate" value={`${number(summary.winRate, 1)}%`} />
          <Stat label="Profit hôm nay" value={money(summary.profitToday)} tone={summary.profitToday < 0 ? "negative" : "positive"} note="Tính theo UTC" />
          <Stat label="Profit toàn thời gian" value={money(summary.profit)} tone={summary.profit < 0 ? "negative" : "positive"} />
          <Stat label="Tổng volume" value={money(summary.volume)} />
        </div>
        <p className="summary-updated muted">Cập nhật: {new Date(summary.generatedAt).toLocaleString("vi-VN")}</p>
      </> : null}
    </section>
  );
}
